/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita credenciales y secretos a la organización.
 * - Guarda solo texto cifrado: el descifrado y la huella los hace el módulo de criptografía, nunca aquí.
 * - Las consultas llevan parámetros enlazados; ningún valor sensible se compone en el SQL.
 */
import type { CredentialKind } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  CredentialRecord,
  CredentialRepository,
  NewCredential,
  NewSecretVersion,
  PasswordVersionSummary,
  RevealLimitNotice,
  SecretField,
  SecretVersionRecord,
} from '../application/ports/credential-repository.js';

interface CredentialRow {
  id: string;
  account_id: string;
  label: string;
  kind: CredentialKind;
  last_rotated_at: Date | null;
  created_by: string;
  created_at: Date;
  archived_at: Date | null;
}

interface SecretRow {
  field: SecretField;
  version: number;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
  is_current: boolean;
  created_by: string;
  created_at: Date;
}

interface PasswordVersionRow {
  version: number;
  is_current: boolean;
  created_at: Date;
  created_by: string;
}

const CREDENTIAL_COLUMNS = `id, account_id, label, kind, last_rotated_at, created_by, created_at, archived_at`;

/** Tipo del aviso que lee el trabajador de correo cuando exista (A8). */
const REVEAL_LIMIT_NOTICE_TYPE = 'credential.reveal_limit_exceeded';
const CREDENTIAL_AGGREGATE = 'credential';

const toRecord = (row: CredentialRow): CredentialRecord => ({
  id: row.id,
  accountId: row.account_id,
  label: row.label,
  kind: row.kind,
  lastRotatedAt: row.last_rotated_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  archivedAt: row.archived_at,
});

export class PgVaultCredentialRepository implements CredentialRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async insertCredential(credential: NewCredential): Promise<CredentialRecord> {
    const result = await this.transactions.current().query<CredentialRow>(
      `insert into credentials (id, organization_id, account_id, label, kind, created_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4, $5)
       returning ${CREDENTIAL_COLUMNS}`,
      [
        credential.id,
        credential.accountId,
        credential.label,
        credential.kind,
        credential.createdBy,
      ],
    );
    return toRecord(requireRow(result.rows[0]));
  }

  async findById(credentialId: string): Promise<CredentialRecord | null> {
    const result = await this.transactions
      .current()
      .query<CredentialRow>(`select ${CREDENTIAL_COLUMNS} from credentials where id = $1`, [
        credentialId,
      ]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findByIdForUpdate(credentialId: string): Promise<CredentialRecord | null> {
    const result = await this.transactions
      .current()
      .query<CredentialRow>(
        `select ${CREDENTIAL_COLUMNS} from credentials where id = $1 for update`,
        [credentialId],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async listByAccount(accountId: string): Promise<readonly CredentialRecord[]> {
    const result = await this.transactions.current().query<CredentialRow>(
      `select ${CREDENTIAL_COLUMNS}
         from credentials
        where account_id = $1 and archived_at is null
        order by lower(label), id`,
      [accountId],
    );
    return result.rows.map(toRecord);
  }

  async currentSecret(
    credentialId: string,
    field: SecretField,
  ): Promise<SecretVersionRecord | null> {
    const result = await this.transactions.current().query<SecretRow>(
      `select field, version, ciphertext, nonce, dek_version, is_current, created_by, created_at
         from credential_secrets
        where credential_id = $1 and field = $2 and is_current`,
      [credentialId, field],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          field: row.field,
          version: row.version,
          ciphertext: new Uint8Array(row.ciphertext),
          nonce: new Uint8Array(row.nonce),
          dekVersion: row.dek_version,
          isCurrent: row.is_current,
          createdBy: row.created_by,
          createdAt: row.created_at,
        };
  }

  async retireCurrentSecret(credentialId: string, field: SecretField): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update credential_secrets set is_current = false where credential_id = $1 and field = $2 and is_current',
        [credentialId, field],
      );
  }

  async insertSecret(secret: NewSecretVersion): Promise<void> {
    await this.transactions.current().query(
      `insert into credential_secrets
         (id, organization_id, credential_id, field, version, ciphertext, nonce, dek_version, blind_index, created_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4, $5, $6, $7,
               case when $8::text is null then null else decode($8::text, 'hex') end, $9)`,
      [
        secret.id,
        secret.credentialId,
        secret.field,
        secret.version,
        Buffer.from(secret.ciphertext),
        Buffer.from(secret.nonce),
        secret.dekVersion,
        secret.blindIndexHex,
        secret.createdBy,
      ],
    );
  }

  async upsertPasswordFingerprint(credentialId: string, hmacHex: string): Promise<void> {
    await this.transactions.current().query(
      `insert into password_fingerprints (organization_id, credential_id, hmac)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, decode($2, 'hex'))
       on conflict (organization_id, credential_id) do update set hmac = excluded.hmac`,
      [credentialId, hmacHex],
    );
  }

  async markRotated(credentialId: string, at: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update credentials set last_rotated_at = $2 where id = $1', [credentialId, at]);
  }

  async passwordHistory(credentialId: string): Promise<readonly PasswordVersionSummary[]> {
    const result = await this.transactions.current().query<PasswordVersionRow>(
      `select version, is_current, created_at, created_by
         from credential_secrets
        where credential_id = $1 and field = 'password'
        order by version desc`,
      [credentialId],
    );
    return result.rows.map((row) => ({
      version: row.version,
      isCurrent: row.is_current,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));
  }

  async lockRevealsOf(userId: UserId): Promise<void> {
    await this.transactions
      .current()
      .query(
        "select pg_advisory_xact_lock(hashtextextended('reveal:' || current_setting('app.org_id', true) || ':' || $1::text, 0))",
        [userId],
      );
  }

  async enqueueRevealLimitNotice(notice: RevealLimitNotice): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        CREDENTIAL_AGGREGATE,
        REVEAL_LIMIT_NOTICE_TYPE,
        JSON.stringify({ actorId: notice.actorId, limitPerHour: notice.limitPerHour }),
      ],
    );
  }
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('Expected the statement to return a row');
  return row;
}
