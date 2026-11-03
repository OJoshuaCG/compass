/**
 * Escritura y lectura de la conexión IMAP de una fuente (`mail_source_connections`, migración 0029) con el rol
 * de la aplicación. La contraseña solo entra ya cifrada y nunca se lee de vuelta: se informa si existe.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { MailTlsMode } from '../application/ports/mail-connection-loader.js';
import type {
  InboundSourceConnectionRepository,
  SourceConnectionRecord,
  SourceConnectionWrite,
} from '../application/ports/inbound-source-connection-repository.js';

interface ConnectionRow {
  readonly source_id: string;
  readonly host: string;
  readonly port: number;
  readonly tls_mode: MailTlsMode;
  readonly username: string;
  readonly authserv_id: string;
  readonly accepted_recipients: string[];
  readonly has_password: boolean;
  readonly secret_version: number;
  readonly updated_at: Date;
}

const CONNECTION_COLUMNS = `source_id, host, port, tls_mode, username, authserv_id, accepted_recipients,
  password_nonce is not null as has_password, secret_version, updated_at`;

const toRecord = (row: ConnectionRow): SourceConnectionRecord => ({
  sourceId: row.source_id,
  host: row.host,
  port: row.port,
  tlsMode: row.tls_mode,
  username: row.username,
  authservId: row.authserv_id,
  acceptedRecipients: row.accepted_recipients,
  hasPassword: row.has_password,
  secretVersion: row.secret_version,
  updatedAt: row.updated_at,
});

/** Columnas de la contraseña según el cambio pedido; `keep` no las toca. */
function passwordValues(
  connection: SourceConnectionWrite,
): { ciphertext: Buffer | null; nonce: Buffer | null; dekVersion: number | null } | null {
  if (connection.password.kind === 'keep') return null;
  if (connection.password.kind === 'clear')
    return { ciphertext: null, nonce: null, dekVersion: null };
  return {
    ciphertext: Buffer.from(connection.password.encrypted.ciphertext),
    nonce: Buffer.from(connection.password.encrypted.nonce),
    dekVersion: connection.password.encrypted.dekVersion,
  };
}

export class PgInboundSourceConnectionRepository implements InboundSourceConnectionRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async find(sourceId: string): Promise<SourceConnectionRecord | null> {
    const result = await this.transactions
      .current()
      .query<ConnectionRow>(
        `select ${CONNECTION_COLUMNS} from mail_source_connections where source_id = $1`,
        [sourceId],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findForUpdate(sourceId: string): Promise<SourceConnectionRecord | null> {
    const result = await this.transactions
      .current()
      .query<ConnectionRow>(
        `select ${CONNECTION_COLUMNS} from mail_source_connections where source_id = $1 for update`,
        [sourceId],
      );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async countUserEmails(addresses: readonly string[]): Promise<number> {
    const result = await this.transactions.current().query<{ total: string }>(
      `select count(*)::text as total
         from users
        where email = any($1::text[])`,
      [[...addresses]],
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async insert(connection: SourceConnectionWrite): Promise<SourceConnectionRecord> {
    const password = passwordValues(connection);
    const result = await this.transactions.current().query<ConnectionRow>(
      `insert into mail_source_connections
         (organization_id, source_id, host, port, tls_mode, username, authserv_id, accepted_recipients,
          password_ciphertext, password_nonce, dek_version, secret_version, created_by)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7::text[],
               $8::bytea, $9::bytea, $10::integer, $11, $12)
       returning ${CONNECTION_COLUMNS}`,
      [
        connection.sourceId,
        connection.host,
        connection.port,
        connection.tlsMode,
        connection.username,
        connection.authservId,
        [...connection.acceptedRecipients],
        password?.ciphertext ?? null,
        password?.nonce ?? null,
        password?.dekVersion ?? null,
        connection.secretVersion,
        connection.createdBy,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('The connection insert returned no row');
    return toRecord(row);
  }

  async update(connection: SourceConnectionWrite): Promise<SourceConnectionRecord> {
    const password = passwordValues(connection);
    // `keep` deja las tres columnas de la contraseña y su versión como están: `$8` indica si se reescriben.
    const result = await this.transactions.current().query<ConnectionRow>(
      `update mail_source_connections
          set host = $2,
              port = $3,
              tls_mode = $4,
              username = $5,
              authserv_id = $6,
              accepted_recipients = $7::text[],
              password_ciphertext = case when $8::boolean then $9::bytea else password_ciphertext end,
              password_nonce = case when $8::boolean then $10::bytea else password_nonce end,
              dek_version = case when $8::boolean then $11::integer else dek_version end,
              secret_version = $12,
              version = version + 1
        where source_id = $1
        returning ${CONNECTION_COLUMNS}`,
      [
        connection.sourceId,
        connection.host,
        connection.port,
        connection.tlsMode,
        connection.username,
        connection.authservId,
        [...connection.acceptedRecipients],
        password !== null,
        password?.ciphertext ?? null,
        password?.nonce ?? null,
        password?.dekVersion ?? null,
        connection.secretVersion,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('The connection update matched no row');
    return toRecord(row);
  }
}
