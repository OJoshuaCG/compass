/**
 * Registro de clientes OIDC por API (ADR 0052, decisión 1A): crear, listar, rotar el secreto y deshabilitar.
 *
 * Invariantes de seguridad
 * - Todo exige `sso.clients.manage` (reautenticación reciente según el catálogo). Marcar un cliente con
 *   `allowPrivateNetworkBackchannel` exige además `org.settings` (solo Raíz): abre el aviso back-channel a
 *   redes internas y por eso no lo decide cualquier administrador.
 * - El secreto se genera aquí con aleatoriedad criptográfica, se cifra solo con el módulo de criptografía y
 *   se devuelve UNA vez al crear o rotar. Nunca se registra, se audita ni se lista; el buffer en claro se borra.
 * - Todo lo que responde con `err` va ANTES de la primera escritura: la unidad de trabajo confirma cualquier
 *   retorno que no lance. Un fallo de cifrado se LANZA para revertir.
 * - La auditoría es el último paso de cada escritura y solo lleva el `client_id` público y banderas.
 * - Un cliente deshabilitado no se reactiva: se registra otro. Eso cierra la puerta a reutilizar redirecciones viejas.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { CryptoPrimitives, SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { clientSecretContext, packClientSecret } from '../domain/client-secret.js';
import {
  invalidClientField,
  isClientRank,
  normalizeClientName,
  normalizeRedirectUri,
  normalizeRefreshJustification,
  normalizeUriList,
} from '../domain/oidc-client.js';
import type { ClientRank, OidcClientRecord } from '../domain/oidc-client.js';
import type { OidcClientStore } from './ports/oidc-client-store.js';

const MANAGE_PERMISSION = 'sso.clients.manage';
const ROOT_ONLY_PERMISSION = 'org.settings';
const AUDIT_TARGET_TYPE = 'oidc_client';
const CLIENT_ID_PREFIX = 'cmp_';
const CLIENT_ID_RANDOM_BYTES = 16;
const CLIENT_SECRET_RANDOM_BYTES = 32;

export interface ManageOidcClientsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly clients: OidcClientStore;
  readonly cipher: Pick<SecretCipher, 'encrypt'>;
  readonly random: Pick<CryptoPrimitives, 'randomBytes'>;
  readonly newId: () => string;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface RegisterOidcClientInput {
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris?: readonly string[] | undefined;
  readonly backchannelLogoutUri?: string | null | undefined;
  readonly allowPrivateNetworkBackchannel?: boolean | undefined;
  readonly refreshJustification?: string | null | undefined;
  readonly isExternal?: boolean | undefined;
  readonly maxRank?: number | null | undefined;
}

/** `clientSecret` se muestra una sola vez; después solo existe cifrado. */
export interface RegisteredOidcClient {
  readonly client: OidcClientRecord;
  readonly clientSecret: string;
}

export class ManageOidcClients {
  constructor(private readonly deps: ManageOidcClientsDeps) {}

  list(): Promise<Result<readonly OidcClientRecord[], DomainError>> {
    const { uow, authorizer, clients } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: MANAGE_PERMISSION });
      return ok(await clients.list());
    });
  }

  register(input: RegisterOidcClientInput): Promise<Result<RegisteredOidcClient, DomainError>> {
    const { uow, authorizer, clients } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: MANAGE_PERMISSION });
      const actorId = this.requireActorId();

      const validated = validate(input);
      if (!validated.ok) return validated;
      const fields = validated.value;
      if (fields.allowPrivateNetworkBackchannel) {
        await authorizer.require({ permission: ROOT_ONLY_PERMISSION });
      }

      const id = this.deps.newId();
      const clientId = this.generateClientId();
      const clientSecret = this.generateClientSecret();
      const secretCiphertext = await this.sealSecret(id, clientSecret);

      const created = await clients.insert({
        id,
        clientId,
        ...fields,
        secretCiphertext,
        createdBy: actorId,
      });
      // Sin fila: el `client_id` generado chocó con otro (índice único). Es astronómicamente raro; se pide reintentar.
      if (created === null) {
        return err(new DomainError('FEDERATION.CLIENT_ID_CONFLICT', 'Client id already exists'));
      }
      await this.recordAudit('oidc_client.created', actorId, created.id, {
        clientId,
        isExternal: fields.isExternal,
        allowRefreshTokens: fields.allowRefreshTokens,
        maxRank: fields.maxRank ?? -1,
      });
      return ok({ client: created, clientSecret });
    });
  }

  rotateSecret(id: string): Promise<Result<RegisteredOidcClient, DomainError>> {
    const { uow, clients } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(id);
      if (!current.ok) return current;
      const actorId = this.requireActorId();

      const clientSecret = this.generateClientSecret();
      await clients.replaceSecret(id, await this.sealSecret(id, clientSecret));
      await this.recordAudit('oidc_client.secret_rotated', actorId, id, {
        clientId: current.value.clientId,
      });
      return ok({ client: current.value, clientSecret });
    });
  }

  disable(id: string): Promise<Result<OidcClientRecord, DomainError>> {
    const { uow, clients, clock } = this.deps;
    return uow.run(async () => {
      const current = await this.loadManageable(id);
      if (!current.ok) return current;
      const actorId = this.requireActorId();

      const saved = await clients.disable(id, clock.now());
      await this.recordAudit('oidc_client.disabled', actorId, id, {
        clientId: current.value.clientId,
      });
      return ok(saved);
    });
  }

  private async loadManageable(id: string): Promise<Result<OidcClientRecord, DomainError>> {
    await this.deps.authorizer.require({ permission: MANAGE_PERMISSION });
    const client = await this.deps.clients.findForUpdate(id);
    if (client === null) return err(new DomainError('NOT_FOUND', 'Client not found'));
    if (client.status === 'disabled') {
      return err(new DomainError('FEDERATION.CLIENT_DISABLED', 'Client is disabled'));
    }
    return ok(client);
  }

  /** Cifra el secreto; el texto en claro se borra aunque falle. Un fallo se LANZA para revertir. */
  private async sealSecret(clientRowId: string, secret: string): Promise<Uint8Array> {
    const { cipher, context } = this.deps;
    const bytes = new TextEncoder().encode(secret);
    try {
      const encrypted = await cipher.encrypt(
        clientSecretContext(context.current().organizationId, clientRowId),
        bytes,
      );
      if (!encrypted.ok) throw encrypted.error;
      return packClientSecret(encrypted.value);
    } finally {
      bytes.fill(0);
    }
  }

  private generateClientId(): string {
    const random = this.deps.random.randomBytes(CLIENT_ID_RANDOM_BYTES);
    return `${CLIENT_ID_PREFIX}${Buffer.from(random).toString('base64url')}`;
  }

  private generateClientSecret(): string {
    const random = this.deps.random.randomBytes(CLIENT_SECRET_RANDOM_BYTES);
    try {
      return Buffer.from(random).toString('base64url');
    } finally {
      random.fill(0);
    }
  }

  private async recordAudit(
    action: string,
    actorId: UserId,
    targetId: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    const { audit, context } = this.deps;
    await audit.record({
      action,
      actorId,
      targetType: AUDIT_TARGET_TYPE,
      targetId,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: context.current().requestId,
      metadata,
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

interface ValidatedClient {
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris: readonly string[];
  readonly backchannelLogoutUri: string | null;
  readonly allowPrivateNetworkBackchannel: boolean;
  readonly allowRefreshTokens: boolean;
  readonly refreshJustification: string | null;
  readonly isExternal: boolean;
  readonly maxRank: ClientRank | null;
}

function validate(input: RegisterOidcClientInput): Result<ValidatedClient, DomainError> {
  const name = normalizeClientName(input.name);
  if (name === null) return invalidClientField('name');

  const redirectUris = normalizeUriList(input.redirectUris);
  if (redirectUris === null || redirectUris.length === 0) return invalidClientField('redirectUris');

  const postLogoutRedirectUris = normalizeUriList(input.postLogoutRedirectUris ?? []);
  if (postLogoutRedirectUris === null) return invalidClientField('postLogoutRedirectUris');

  const backchannelRaw = input.backchannelLogoutUri ?? null;
  const backchannelLogoutUri =
    backchannelRaw === null ? null : normalizeRedirectUri(backchannelRaw);
  if (backchannelRaw !== null && backchannelLogoutUri === null) {
    return invalidClientField('backchannelLogoutUri');
  }

  // El refresh token solo existe si se justifica (ADR 0051 D2): sin justificación no se emite.
  const justificationRaw = input.refreshJustification ?? null;
  const refreshJustification =
    justificationRaw === null ? null : normalizeRefreshJustification(justificationRaw);
  if (justificationRaw !== null && refreshJustification === null) {
    return invalidClientField('refreshJustification');
  }

  const rankRaw = input.maxRank ?? null;
  if (rankRaw !== null && !isClientRank(rankRaw)) return invalidClientField('maxRank');

  return ok({
    name,
    redirectUris,
    postLogoutRedirectUris,
    backchannelLogoutUri,
    allowPrivateNetworkBackchannel: input.allowPrivateNetworkBackchannel === true,
    allowRefreshTokens: refreshJustification !== null,
    refreshJustification,
    isExternal: input.isExternal === true,
    maxRank: rankRaw,
  });
}
