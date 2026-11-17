/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita las consultas a la organización
 *   fijada, que se toma de `app.org_id` y nunca de un parámetro del llamador.
 * - Solo toca el texto cifrado de la contraseña; nunca lo descifra ni lo registra. Las lecturas de la
 *   configuración no seleccionan el secreto: solo si existe.
 * - La configuración (host, puerto, seguridad, usuario, remitente) vive en `integrations.config`; la
 *   contraseña, en `integration_secrets` con el campo `smtp_password`.
 */
import type { SmtpSecurityValue } from '@iam/contracts';

import type { TransactionProvider } from '../../organization/index.js';
import type {
  NewSmtpSettings,
  SmtpConnectionFields,
  SmtpSettingsRecord,
  SmtpSettingsStore,
  StoredSmtpPassword,
} from '../application/ports/smtp-settings-store.js';
import { SMTP_INTEGRATION_KIND } from '../domain/smtp-config.js';

const PASSWORD_FIELD = 'smtp_password';

interface SmtpRow {
  id: string;
  name: string;
  status: 'active' | 'archived';
  host: unknown;
  port: unknown;
  security: unknown;
  username: unknown;
  from_address: unknown;
  has_password: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SecretRow {
  secret_version: number;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

const SETTINGS_COLUMNS = `integrations.id,
       integrations.name,
       integrations.status,
       integrations.config ->> 'host' as host,
       (integrations.config ->> 'port')::int as port,
       integrations.config ->> 'security' as security,
       integrations.config ->> 'username' as username,
       integrations.config ->> 'fromAddress' as from_address,
       exists (select 1
                 from integration_secrets
                where integration_secrets.organization_id = integrations.organization_id
                  and integration_secrets.integration_id = integrations.id
                  and integration_secrets.field = '${PASSWORD_FIELD}') as has_password,
       integrations.created_at,
       integrations.updated_at`;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRecord(row: SmtpRow): SmtpSettingsRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    host: asText(row.host),
    port: typeof row.port === 'number' ? row.port : 0,
    security: row.security === 'tls' ? 'tls' : ('starttls' satisfies SmtpSecurityValue),
    username: asText(row.username),
    fromAddress: asText(row.from_address),
    hasPassword: row.has_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireRow(row: SmtpRow | undefined, operation: string): SmtpSettingsRecord {
  if (row === undefined) throw new Error(`The SMTP settings ${operation} returned no row`);
  return toRecord(row);
}

/** Los campos de conexión como objeto `config`; se pasan como un único parámetro jsonb. */
function toConfigJson(fields: SmtpConnectionFields): string {
  return JSON.stringify({
    host: fields.host,
    port: fields.port,
    security: fields.security,
    username: fields.username,
    fromAddress: fields.fromAddress,
  });
}

export class PgSmtpSettingsStore implements SmtpSettingsStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async findForUpdate(settingsId: string): Promise<SmtpSettingsRecord | null> {
    const result = await this.transactions.current().query<SmtpRow>(
      `select ${SETTINGS_COLUMNS}
         from integrations
        where integrations.id = $1
          and integrations.kind = $2
          for update of integrations`,
      [settingsId, SMTP_INTEGRATION_KIND],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findActive(): Promise<SmtpSettingsRecord | null> {
    const result = await this.transactions.current().query<SmtpRow>(
      `select ${SETTINGS_COLUMNS}
         from integrations
        where integrations.kind = $1
          and integrations.status = 'active'
        limit 1`,
      [SMTP_INTEGRATION_KIND],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async list(): Promise<readonly SmtpSettingsRecord[]> {
    const result = await this.transactions.current().query<SmtpRow>(
      `select ${SETTINGS_COLUMNS}
         from integrations
        where integrations.kind = $1
        order by (integrations.status = 'active') desc, integrations.created_at desc, integrations.id desc`,
      [SMTP_INTEGRATION_KIND],
    );
    return result.rows.map(toRecord);
  }

  async insert(settings: NewSmtpSettings): Promise<SmtpSettingsRecord | null> {
    const result = await this.transactions.current().query<{ id: string }>(
      `insert into integrations (organization_id, kind, name, config, created_by)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb, $4)
       on conflict do nothing
       returning id`,
      [SMTP_INTEGRATION_KIND, settings.name, toConfigJson(settings), settings.createdBy],
    );
    const inserted = result.rows[0];
    // Sin fila: otra petición creó la configuración activa entre la lectura y este alta (índice único
    // parcial). `do nothing` evita el error 23505, que dejaría abortada la transacción en curso.
    if (inserted === undefined) return null;
    return this.reread(inserted.id, 'insert');
  }

  async update(
    settingsId: string,
    changes: SmtpConnectionFields & { readonly name: string },
  ): Promise<SmtpSettingsRecord> {
    await this.transactions.current().query(
      `update integrations
          set name = $2,
              config = $3::jsonb,
              version = version + 1
        where id = $1
          and kind = $4`,
      [settingsId, changes.name, toConfigJson(changes), SMTP_INTEGRATION_KIND],
    );
    return this.reread(settingsId, 'update');
  }

  async archive(settingsId: string, archivedAt: Date): Promise<SmtpSettingsRecord> {
    await this.transactions.current().query(
      `update integrations
          set status = 'archived',
              archived_at = $2,
              version = version + 1
        where id = $1
          and kind = $3`,
      [settingsId, archivedAt, SMTP_INTEGRATION_KIND],
    );
    return this.reread(settingsId, 'archive');
  }

  async findPassword(settingsId: string): Promise<StoredSmtpPassword | null> {
    const result = await this.transactions.current().query<SecretRow>(
      `select secret_version, ciphertext, nonce, dek_version
         from integration_secrets
        where integration_id = $1
          and field = '${PASSWORD_FIELD}'`,
      [settingsId],
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

  async putPassword(secret: {
    readonly settingsId: string;
    readonly secretVersion: number;
    readonly encrypted: { ciphertext: Uint8Array; nonce: Uint8Array; dekVersion: number };
    readonly rotatedAt: Date;
  }): Promise<void> {
    await this.transactions.current().query(
      `insert into integration_secrets
         (organization_id, integration_id, field, ciphertext, nonce, dek_version, secret_version, rotated_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, '${PASSWORD_FIELD}',
               $2::bytea, $3::bytea, $4, $5, $6)
       on conflict (organization_id, integration_id, field) do update
          set ciphertext = excluded.ciphertext,
              nonce = excluded.nonce,
              dek_version = excluded.dek_version,
              secret_version = excluded.secret_version,
              rotated_at = excluded.rotated_at`,
      [
        secret.settingsId,
        Buffer.from(secret.encrypted.ciphertext),
        Buffer.from(secret.encrypted.nonce),
        secret.encrypted.dekVersion,
        secret.secretVersion,
        secret.rotatedAt,
      ],
    );
  }

  private async reread(settingsId: string, operation: string): Promise<SmtpSettingsRecord> {
    const result = await this.transactions
      .current()
      .query<SmtpRow>(`select ${SETTINGS_COLUMNS} from integrations where integrations.id = $1`, [
        settingsId,
      ]);
    return requireRow(result.rows[0], operation);
  }
}
