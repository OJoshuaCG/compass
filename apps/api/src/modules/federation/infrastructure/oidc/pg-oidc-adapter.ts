/**
 * Adaptador de almacenamiento de `oidc-provider` sobre PostgreSQL (`oidc_payloads`, `oidc_clients`).
 * ADR 0051 (sesión raíz) y ADR 0052 (decisiones 5 a 7).
 *
 * Invariantes de seguridad
 * - Toda lectura y escritura corre en `TenantScope.runAs(organización)`: RLS aísla por organización. La
 *   organización sale de la sesión de Compass de la petición, del cliente (cuando el cuerpo lo trae) o de la
 *   propia clave consultada, mediante funciones `auth.*` de solo lectura. Si ambas fuentes existen y no
 *   coinciden, se rechaza.
 * - Los identificadores que el paquete trata como secreto se guardan como SHA-256 (`key_hash`); el campo
 *   `jti` del contenido no se guarda y se reconstruye al leer.
 * - Cada fila nace ligada a una sesión de Compass viva: Sesión e Interacción con la del contexto, el resto con
 *   la de su Grant. El vencimiento se recorta al de esa sesión y, si la sesión ya no está viva o el Grant fue
 *   revocado, escribir falla: nunca nace una credencial que sobreviva a la sesión raíz.
 * - Un cliente deshabilitado no se resuelve: sus tokens dejan de poder pedirse aunque no se hayan borrado.
 */
import type { Adapter, AdapterConstructor, AdapterPayload } from 'oidc-provider';

import { asOrganizationId } from '../../../../shared/kernel/index.js';
import type { Clock, IdGenerator } from '../../../../shared/kernel/index.js';
import type { CryptoPrimitives, SecretCipher } from '../../../crypto/index.js';
import type { TenantScope, TransactionProvider } from '../../../organization/index.js';
import type { OidcAmbientReader } from '../../application/ports/oidc-ambient.js';
import { clientSecretContext, unpackClientSecret } from '../../domain/client-secret.js';
import type { PgOidcOrgResolver } from './oidc-org-resolver.js';

const CLIENT_MODEL = 'Client';
const GRANT_MODEL = 'Grant';
const SESSION_MODEL = 'Session';
const INTERACTION_MODEL = 'Interaction';
const STORED_MODELS: readonly string[] = [
  'Session',
  'AccessToken',
  'AuthorizationCode',
  'RefreshToken',
  'Grant',
  'Interaction',
  'ReplayDetection',
];
/** Modelos que nacen de una concesión: heredan persona y sesión de su Grant. */
const GRANT_BOUND_MODELS: readonly string[] = ['AccessToken', 'AuthorizationCode', 'RefreshToken'];

export interface PgOidcAdapterDeps {
  readonly scope: TenantScope;
  readonly transactions: TransactionProvider;
  readonly resolver: PgOidcOrgResolver;
  readonly ambient: OidcAmbientReader;
  readonly primitives: Pick<CryptoPrimitives, 'sha256'>;
  readonly cipher: Pick<SecretCipher, 'decrypt'>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

interface PayloadRow {
  readonly payload: AdapterPayload;
  readonly consumed_at: Date | null;
}

interface SessionLinkRow {
  readonly compass_session_id: string | null;
}

interface GrantOwnerRow {
  readonly user_id: string | null;
  readonly compass_session_id: string | null;
}

interface SessionExpiryRow {
  readonly expires_at: Date;
}

interface ClientRow {
  readonly id: string;
  readonly client_id: string;
  readonly name: string;
  readonly secret_ciphertext: Buffer;
  readonly redirect_uris: string[];
  readonly post_logout_redirect_uris: string[];
  readonly backchannel_logout_uri: string | null;
  readonly allow_private_network_backchannel: boolean;
  readonly allow_refresh_tokens: boolean;
  readonly is_external: boolean;
  readonly max_rank: number | null;
}

export class OidcStorageError extends Error {}

const stringField = (payload: AdapterPayload, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/** El cliente de un payload: `clientId` en tokens y concesiones; `params.client_id` en las interacciones. */
const clientIdOf = (payload: AdapterPayload): string | null => {
  const direct = stringField(payload, 'clientId');
  if (direct !== null) return direct;
  const params = payload['params'];
  if (typeof params === 'object' && params !== null) {
    return stringField(params as AdapterPayload, 'client_id');
  }
  return null;
};

export function createPgOidcAdapter(deps: PgOidcAdapterDeps): AdapterConstructor {
  const { scope, transactions, resolver, ambient, primitives, ids, clock } = deps;

  const hashKey = (id: string): Buffer =>
    Buffer.from(primitives.sha256(new TextEncoder().encode(id)));

  const runInOrganization = <T>(organizationId: string, work: () => Promise<T>): Promise<T> =>
    scope.runAs(
      { organizationId: asOrganizationId(organizationId), actorId: null, requestId: ids.next() },
      work,
    );

  class PgOidcAdapter implements Adapter {
    constructor(private readonly model: string) {
      if (model !== CLIENT_MODEL && !STORED_MODELS.includes(model)) {
        // Función no habilitada (dispositivo, CIBA, registro dinámico…): fallar fuerte, no guardar a ciegas.
        throw new OidcStorageError(`Unsupported oidc-provider model: ${model}`);
      }
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      if (this.model === CLIENT_MODEL) return this.findClient(id);
      const organizationId =
        ambient.current()?.organizationId ?? (await resolver.byPayloadKey(this.model, hashKey(id)));
      if (organizationId === null) return undefined;
      return runInOrganization(organizationId, async () => {
        const result = await transactions.current().query<PayloadRow & SessionLinkRow>(
          `select payload, consumed_at, compass_session_id from oidc_payloads
            where model = $1 and key_hash = $2 and expires_at > now()`,
          [this.model, hashKey(id)],
        );
        const row = result.rows[0];
        if (row === undefined || !this.sessionMatchesCompassSession(row)) return undefined;
        return toProviderPayload(row, id);
      });
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      if (this.model !== SESSION_MODEL && this.model !== INTERACTION_MODEL) return undefined;
      const organizationId =
        ambient.current()?.organizationId ?? (await resolver.byUid(this.model, uid));
      if (organizationId === null) return undefined;
      return runInOrganization(organizationId, async () => {
        const result = await transactions
          .current()
          .query<PayloadRow & SessionLinkRow & { key_hash: Buffer }>(
            `select payload, consumed_at, key_hash, compass_session_id from oidc_payloads
              where model = $1 and uid = $2 and expires_at > now()`,
            [this.model, uid],
          );
        const row = result.rows[0];
        if (row === undefined) return undefined;
        if (ambient.current() === null) {
          // Comprobación de vínculo de un token (punto de token, cierre de sesión): no hay cookie de Compass, así
          // que la sesión del proveedor solo «existe» mientras viva la sesión de Compass a la que está ligada.
          if (!(await this.compassSessionIsAlive(row.compass_session_id))) return undefined;
        } else if (!this.sessionMatchesCompassSession(row)) {
          return undefined;
        }
        // Sesión e Interacción guardan su `jti` en el contenido (ver `storesJti`); `uid` es solo el respaldo.
        return toProviderPayload(row, stringField(row.payload, 'jti') ?? uid);
      });
    }

    /**
     * La sesión del proveedor no basta por sí sola (ADR 0051 §1, L8): solo vale cuando la petición trae
     * además la cookie de la sesión de Compass a la que está ligada. Sin ella (otra persona en el mismo
     * navegador, sesión de Compass cerrada o cookie del proveedor robada) la sesión «no existe».
     */
    private sessionMatchesCompassSession(row: SessionLinkRow): boolean {
      if (this.model !== SESSION_MODEL) return true;
      const current = ambient.current();
      return (
        current !== null &&
        row.compass_session_id !== null &&
        row.compass_session_id === current.compassSessionId
      );
    }

    findByUserCode(): Promise<AdapterPayload | undefined> {
      return Promise.reject(new OidcStorageError('Device flow is not supported'));
    }

    async upsert(id: string, payload: AdapterPayload, expiresInSeconds: number): Promise<void> {
      if (this.model === CLIENT_MODEL) {
        throw new OidcStorageError('Clients are managed through the admin API');
      }
      const organizationId = await this.organizationForWrite(payload);
      await runInOrganization(organizationId, async () => {
        const owner = await this.resolveOwner(payload);
        const expiresAt = await this.clipToSession(expiresInSeconds, owner.compassSessionId);
        const { consumed, ...withoutConsumed } = payload;
        const stored = this.storesJti() ? withoutConsumed : omitJti(withoutConsumed);
        await transactions.current().query(
          `insert into oidc_payloads (
             organization_id, model, key_hash, payload, grant_id, uid, user_id, compass_session_id,
             expires_at, consumed_at)
           values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb, $4, $5, $6, $7, $8,
                   case when $9::bigint is null then null else to_timestamp($9::bigint) end)
           on conflict (model, key_hash) do update
             set payload = excluded.payload,
                 grant_id = excluded.grant_id,
                 uid = excluded.uid,
                 user_id = excluded.user_id,
                 compass_session_id = excluded.compass_session_id,
                 expires_at = excluded.expires_at,
                 consumed_at = coalesce(excluded.consumed_at, oidc_payloads.consumed_at)`,
          [
            this.model,
            hashKey(id),
            JSON.stringify(stored),
            this.model === GRANT_MODEL ? id : stringField(payload, 'grantId'),
            stringField(payload, 'uid'),
            owner.userId,
            owner.compassSessionId,
            expiresAt,
            typeof consumed === 'number' ? consumed : null,
          ],
        );
      });
    }

    async consume(id: string): Promise<void> {
      await this.withOrganizationOf(id, async () => {
        await transactions
          .current()
          .query(
            `update oidc_payloads set consumed_at = now() where model = $1 and key_hash = $2`,
            [this.model, hashKey(id)],
          );
      });
    }

    async destroy(id: string): Promise<void> {
      await this.withOrganizationOf(id, async () => {
        await transactions
          .current()
          .query(`delete from oidc_payloads where model = $1 and key_hash = $2`, [
            this.model,
            hashKey(id),
          ]);
      });
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      const organizationId =
        ambient.current()?.organizationId ??
        (await resolver.byPayloadKey(GRANT_MODEL, hashKey(grantId)));
      if (organizationId === null) return;
      await runInOrganization(organizationId, async () => {
        await transactions
          .current()
          .query(`delete from oidc_payloads where grant_id = $1`, [grantId]);
      });
    }

    /**
     * Sesión e Interacción conservan su `jti`: se buscan por `uid` y el paquete necesita el identificador
     * original para volver a guardarlas sobre la misma fila. Los tokens y códigos (secretos portadores) no.
     */
    private storesJti(): boolean {
      return this.model === SESSION_MODEL || this.model === INTERACTION_MODEL;
    }

    private async withOrganizationOf(id: string, work: () => Promise<void>): Promise<void> {
      const organizationId =
        ambient.current()?.organizationId ?? (await resolver.byPayloadKey(this.model, hashKey(id)));
      // Sin organización la fila no existe o ya venció: destruir o consumir lo que no está es un no-op.
      if (organizationId === null) return;
      await runInOrganization(organizationId, work);
    }

    /** Organización de una escritura: la del contexto o la del cliente; si hay ambas y difieren, se rechaza. */
    private async organizationForWrite(payload: AdapterPayload): Promise<string> {
      const fromContext = ambient.current()?.organizationId ?? null;
      const clientId = clientIdOf(payload);
      const fromClient = clientId === null ? null : await resolver.byActiveClientId(clientId);
      if (fromContext !== null && fromClient !== null && fromContext !== fromClient) {
        throw new OidcStorageError('Client does not belong to the organization of the session');
      }
      if (clientId !== null && fromClient === null) {
        throw new OidcStorageError('Client is unknown or disabled');
      }
      const organizationId = fromContext ?? fromClient;
      if (organizationId === null) {
        throw new OidcStorageError('Cannot resolve the organization of an oidc payload');
      }
      return organizationId;
    }

    /** Persona y sesión de Compass a las que se liga la fila (ADR 0051 §2). */
    private async resolveOwner(
      payload: AdapterPayload,
    ): Promise<{ userId: string | null; compassSessionId: string | null }> {
      const context = ambient.current();
      if (this.model === SESSION_MODEL) {
        if (context === null)
          throw new OidcStorageError('A provider session needs a Compass session');
        const accountId = stringField(payload, 'accountId');
        if (accountId !== null && accountId !== context.userId) {
          throw new OidcStorageError('Provider session account differs from the Compass session');
        }
        return { userId: context.userId, compassSessionId: context.compassSessionId };
      }
      if (this.model === INTERACTION_MODEL) {
        return {
          userId: context?.userId ?? null,
          compassSessionId: context?.compassSessionId ?? null,
        };
      }
      if (this.model === GRANT_MODEL) {
        if (context === null) throw new OidcStorageError('A grant needs a Compass session');
        return { userId: context.userId, compassSessionId: context.compassSessionId };
      }
      if (GRANT_BOUND_MODELS.includes(this.model)) {
        const grantId = stringField(payload, 'grantId');
        if (grantId === null) throw new OidcStorageError('Token without grant');
        const result = await transactions.current().query<GrantOwnerRow>(
          `select user_id, compass_session_id from oidc_payloads
            where model = $1 and key_hash = $2 and expires_at > now()`,
          [GRANT_MODEL, hashKey(grantId)],
        );
        const owner = result.rows[0];
        // Grant borrado = revocado: no puede nacer ni rotar una credencial a partir de él.
        if (owner === undefined) throw new OidcStorageError('Grant was revoked');
        return { userId: owner.user_id, compassSessionId: owner.compass_session_id };
      }
      return { userId: null, compassSessionId: null };
    }

    private async compassSessionIsAlive(compassSessionId: string | null): Promise<boolean> {
      if (this.model !== SESSION_MODEL) return true;
      if (compassSessionId === null) return false;
      const result = await transactions
        .current()
        .query(
          `select 1 from sessions where id = $1 and revoked_at is null and expires_at > now()`,
          [compassSessionId],
        );
      return result.rows.length > 0;
    }

    private async clipToSession(
      expiresInSeconds: number,
      compassSessionId: string | null,
    ): Promise<Date> {
      const requested = new Date(clock.now().getTime() + expiresInSeconds * 1000);
      if (compassSessionId === null) return requested;
      const result = await transactions
        .current()
        .query<SessionExpiryRow>(
          `select expires_at from sessions where id = $1 and revoked_at is null and expires_at > now()`,
          [compassSessionId],
        );
      const session = result.rows[0];
      if (session === undefined) throw new OidcStorageError('Compass session is no longer alive');
      return session.expires_at < requested ? session.expires_at : requested;
    }

    private async findClient(clientId: string): Promise<AdapterPayload | undefined> {
      const organizationId = await resolver.byActiveClientId(clientId);
      if (organizationId === null) return undefined;
      return runInOrganization(organizationId, async () => {
        const result = await transactions.current().query<ClientRow>(
          `select id, client_id, name, secret_ciphertext, redirect_uris, post_logout_redirect_uris,
                  backchannel_logout_uri, allow_private_network_backchannel, allow_refresh_tokens,
                  is_external, max_rank
             from oidc_clients where client_id = $1 and status = 'active'`,
          [clientId],
        );
        const row = result.rows[0];
        if (row === undefined) return undefined;
        const packed = unpackClientSecret(new Uint8Array(row.secret_ciphertext));
        if (packed === null) throw new OidcStorageError('Client secret is corrupted');
        const opened = await deps.cipher.decrypt(
          clientSecretContext(asOrganizationId(organizationId), row.id),
          packed,
        );
        if (!opened.ok) throw opened.error;
        const clientSecret = new TextDecoder().decode(opened.value);
        opened.value.fill(0);
        return toClientMetadata(row, clientSecret);
      });
    }
  }

  return PgOidcAdapter;
}

const omitJti = (payload: AdapterPayload): AdapterPayload => {
  const copy: AdapterPayload = { ...payload };
  delete copy['jti'];
  return copy;
};

/** `jti` se reconstruye al leer (no se guarda) y `consumed` sale de la columna `consumed_at`. */
function toProviderPayload(row: PayloadRow, id: string): AdapterPayload {
  const payload: AdapterPayload = { jti: id, ...row.payload };
  if (row.consumed_at !== null) {
    payload['consumed'] = Math.floor(row.consumed_at.getTime() / 1000);
  }
  return payload;
}

/**
 * Metadatos del cliente para el paquete. Los campos `compass_*` viajan como metadatos extra
 * (`extraClientMetadata.properties`) para que la interacción de login compruebe el rango y el consentimiento.
 */
function toClientMetadata(row: ClientRow, clientSecret: string): AdapterPayload {
  const grantTypes = row.allow_refresh_tokens
    ? ['authorization_code', 'refresh_token']
    : ['authorization_code'];
  const metadata: AdapterPayload = {
    client_id: row.client_id,
    client_secret: clientSecret,
    client_name: row.name,
    application_type: 'web',
    token_endpoint_auth_method: 'client_secret_basic',
    response_types: ['code'],
    grant_types: grantTypes,
    redirect_uris: row.redirect_uris,
    post_logout_redirect_uris: row.post_logout_redirect_uris,
    backchannel_logout_session_required: true,
    compass_is_external: row.is_external,
    compass_max_rank: row.max_rank,
    compass_allow_private_network_backchannel: row.allow_private_network_backchannel,
  };
  if (row.backchannel_logout_uri !== null) {
    metadata['backchannel_logout_uri'] = row.backchannel_logout_uri;
  }
  return metadata;
}
