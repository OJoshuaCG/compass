/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita las consultas a la organización
 *   fijada; la organización se toma de `app.org_id`, nunca de un parámetro del llamador.
 * - Solo toca el texto cifrado del secreto; nunca lo descifra ni lo registra. Las consultas de lectura no
 *   seleccionan el secreto: solo si existe.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  IntegrationRecord,
  IntegrationRepository,
  NewIntegration,
  StoredIntegrationSecret,
} from '../application/ports/integration-repository.js';
import type { TelegramIntegrationKind } from '../domain/integration-config.js';
import type { IntegrationSecretField } from '../domain/integration-secret-context.js';

interface IntegrationRow {
  id: string;
  kind: TelegramIntegrationKind;
  name: string;
  status: 'active' | 'archived';
  chat_id: unknown;
  has_bot_token: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SecretRow {
  secret_version: number;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

const INTEGRATION_COLUMNS = `integrations.id,
       integrations.kind,
       integrations.name,
       integrations.status,
       integrations.config -> 'chatId' as chat_id,
       exists (select 1
                 from integration_secrets
                where integration_secrets.organization_id = integrations.organization_id
                  and integration_secrets.integration_id = integrations.id
                  and integration_secrets.field = 'bot_token') as has_bot_token,
       integrations.created_at,
       integrations.updated_at`;

function toRecord(row: IntegrationRow): IntegrationRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    status: row.status,
    // Un valor que no sea texto equivale a "sin chat": nunca se envía a un destino inventado.
    chatId: typeof row.chat_id === 'string' ? row.chat_id : null,
    hasBotToken: row.has_bot_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireRow(row: IntegrationRow | undefined, operation: string): IntegrationRecord {
  if (row === undefined) throw new Error(`The integration ${operation} returned no row`);
  return toRecord(row);
}

export class PgIntegrationRepository implements IntegrationRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async findForUpdate(integrationId: string): Promise<IntegrationRecord | null> {
    // `for update of integrations` bloquea solo la integración, no las filas de secretos de la subconsulta.
    const result = await this.transactions.current().query<IntegrationRow>(
      `select ${INTEGRATION_COLUMNS}
         from integrations
        where integrations.id = $1
          for update of integrations`,
      [integrationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findActiveByKind(kind: TelegramIntegrationKind): Promise<IntegrationRecord | null> {
    const result = await this.transactions.current().query<IntegrationRow>(
      `select ${INTEGRATION_COLUMNS}
         from integrations
        where integrations.kind = $1
          and integrations.status = 'active'
        limit 1`,
      [kind],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async listByKinds(
    kinds: readonly TelegramIntegrationKind[],
  ): Promise<readonly IntegrationRecord[]> {
    if (kinds.length === 0) return [];
    const result = await this.transactions.current().query<IntegrationRow>(
      `select ${INTEGRATION_COLUMNS}
         from integrations
        where integrations.kind = any($1::text[])
        order by (integrations.status = 'active') desc, integrations.created_at desc, integrations.id desc`,
      [[...kinds]],
    );
    return result.rows.map(toRecord);
  }

  async insert(integration: NewIntegration): Promise<IntegrationRecord> {
    const result = await this.transactions.current().query<IntegrationRow>(
      `with inserted as (
         insert into integrations (organization_id, kind, name, config, created_by)
         values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2,
                 jsonb_build_object('chatId', $3::text), $4)
         returning id, organization_id, kind, name, status, config, created_at, updated_at
       )
       select inserted.id,
              inserted.kind,
              inserted.name,
              inserted.status,
              inserted.config -> 'chatId' as chat_id,
              false as has_bot_token,
              inserted.created_at,
              inserted.updated_at
         from inserted`,
      [integration.kind, integration.name, integration.chatId, integration.createdBy],
    );
    return requireRow(result.rows[0], 'insert');
  }

  async update(
    integrationId: string,
    changes: { readonly name: string; readonly chatId: string },
  ): Promise<IntegrationRecord> {
    await this.transactions.current().query(
      `update integrations
          set name = $2,
              config = jsonb_set(config, '{chatId}', to_jsonb($3::text)),
              version = version + 1
        where id = $1`,
      [integrationId, changes.name, changes.chatId],
    );
    return this.reread(integrationId, 'update');
  }

  async archive(integrationId: string, archivedAt: Date): Promise<IntegrationRecord> {
    await this.transactions.current().query(
      `update integrations
          set status = 'archived',
              archived_at = $2,
              version = version + 1
        where id = $1`,
      [integrationId, archivedAt],
    );
    return this.reread(integrationId, 'archive');
  }

  async findSecret(
    integrationId: string,
    field: IntegrationSecretField,
  ): Promise<StoredIntegrationSecret | null> {
    const result = await this.transactions.current().query<SecretRow>(
      `select secret_version, ciphertext, nonce, dek_version
         from integration_secrets
        where integration_id = $1
          and field = $2`,
      [integrationId, field],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      secretVersion: row.secret_version,
      encrypted: {
        ciphertext: new Uint8Array(row.ciphertext),
        nonce: new Uint8Array(row.nonce),
        dekVersion: row.dek_version,
      },
    };
  }

  async putSecret(secret: {
    readonly integrationId: string;
    readonly field: IntegrationSecretField;
    readonly secretVersion: number;
    readonly encrypted: { ciphertext: Uint8Array; nonce: Uint8Array; dekVersion: number };
    readonly rotatedAt: Date;
  }): Promise<void> {
    await this.transactions.current().query(
      `insert into integration_secrets
         (organization_id, integration_id, field, ciphertext, nonce, dek_version, secret_version, rotated_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::bytea, $4::bytea, $5, $6, $7)
       on conflict (organization_id, integration_id, field) do update
          set ciphertext = excluded.ciphertext,
              nonce = excluded.nonce,
              dek_version = excluded.dek_version,
              secret_version = excluded.secret_version,
              rotated_at = excluded.rotated_at`,
      [
        secret.integrationId,
        secret.field,
        Buffer.from(secret.encrypted.ciphertext),
        Buffer.from(secret.encrypted.nonce),
        secret.encrypted.dekVersion,
        secret.secretVersion,
        secret.rotatedAt,
      ],
    );
  }

  private async reread(integrationId: string, operation: string): Promise<IntegrationRecord> {
    const result = await this.transactions
      .current()
      .query<IntegrationRow>(
        `select ${INTEGRATION_COLUMNS} from integrations where integrations.id = $1`,
        [integrationId],
      );
    return requireRow(result.rows[0], operation);
  }
}
