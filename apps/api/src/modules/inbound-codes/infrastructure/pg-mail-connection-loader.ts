/**
 * Invariantes de seguridad
 * - La contraseña se descifra con el módulo de criptografía y vive solo en la memoria del proceso; nunca
 *   se registra ni se devuelve en un error. Los bytes descifrados se borran al terminar.
 * - Los fallos salen como códigos acotados, sin texto del servidor ni de la excepción original.
 * - La DEK nunca la crea el worker (ADR 0045, paso 4): si la organización no tiene llave, el resultado es
 *   `KMS_UNAVAILABLE`. Eso lo garantiza `ReadOnlyDataKeyRepository` en el `DataKeyResolver` del worker.
 */
import { DomainError } from '../../../shared/kernel/index.js';
import type { IdGenerator } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type {
  MailConnectionLoader,
  MailConnectionLoadResult,
  MailTlsMode,
} from '../application/ports/mail-connection-loader.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';
import { mailSourcePasswordContext } from '../domain/mail-source-password-context.js';

interface ConnectionRow {
  host: string;
  port: number;
  username: string;
  tls_mode: MailTlsMode;
  authserv_id: string;
  accepted_recipients: string[];
  password_ciphertext: Buffer | null;
  password_nonce: Buffer | null;
  dek_version: number | null;
  secret_version: number;
  address: string;
}

const DECRYPT_FAILED_CODE = 'CRYPTO.DECRYPT_FAILED';

export class PgMailConnectionLoader implements MailConnectionLoader {
  constructor(
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly cipher: SecretCipher,
    private readonly ids: IdGenerator,
  ) {}

  load(source: SourceRef): Promise<MailConnectionLoadResult> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      async (): Promise<MailConnectionLoadResult> => {
        const result = await this.transactions.current().query<ConnectionRow>(
          `select c.host, c.port, c.username, c.tls_mode, c.authserv_id, c.accepted_recipients,
                  c.password_ciphertext, c.password_nonce, c.dek_version, c.secret_version,
                  s.address
             from mail_source_connections c
             join mail_sources s
               on s.organization_id = c.organization_id and s.id = c.source_id
            where c.organization_id = $1
              and c.source_id = $2
              and s.channel = 'mail'
              and s.status = 'active'`,
          [source.organizationId, source.sourceId],
        );
        const row = result.rows[0];
        if (row === undefined) return { ok: false, code: 'CONNECTION_MISSING' };
        if (
          row.password_ciphertext === null ||
          row.password_nonce === null ||
          row.dek_version === null
        ) {
          return { ok: false, code: 'PASSWORD_MISSING' };
        }

        const opened = await this.openPassword(source, row, {
          ciphertext: new Uint8Array(row.password_ciphertext),
          nonce: new Uint8Array(row.password_nonce),
          dekVersion: row.dek_version,
        });
        if (!opened.ok) return opened;

        return {
          ok: true,
          connection: {
            host: row.host,
            port: row.port,
            username: row.username,
            password: opened.password,
            tlsMode: row.tls_mode,
            authservId: row.authserv_id,
            sourceAddress: row.address,
            acceptedRecipients: row.accepted_recipients,
          },
        };
      },
    );
  }

  private async openPassword(
    source: SourceRef,
    row: ConnectionRow,
    secret: { ciphertext: Uint8Array; nonce: Uint8Array; dekVersion: number },
  ): Promise<
    | { readonly ok: true; readonly password: string }
    | { readonly ok: false; readonly code: 'PASSWORD_UNREADABLE' | 'KMS_UNAVAILABLE' }
  > {
    // Una excepción aquí no es de disponibilidad del KMS (el cifrador devuelve esos fallos como resultado):
    // es un defecto o un fallo de base de datos. Se propaga para que el sondeo lo clasifique como
    // inesperado en lugar de disfrazarlo de un KMS caído.
    const decrypted = await this.cipher.decrypt(
      mailSourcePasswordContext(source.organizationId, source.sourceId, row.secret_version),
      secret,
    );
    if (!decrypted.ok) {
      return decrypted.error instanceof DomainError && decrypted.error.code === DECRYPT_FAILED_CODE
        ? { ok: false, code: 'PASSWORD_UNREADABLE' }
        : { ok: false, code: 'KMS_UNAVAILABLE' };
    }
    try {
      return {
        ok: true,
        password: new TextDecoder('utf-8', { fatal: true }).decode(decrypted.value),
      };
    } catch {
      return { ok: false, code: 'PASSWORD_UNREADABLE' };
    } finally {
      decrypted.value.fill(0);
    }
  }
}
