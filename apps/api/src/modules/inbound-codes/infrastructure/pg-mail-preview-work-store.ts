/**
 * Invariantes de seguridad
 * - El descubrimiento usa solo funciones `auth.*` (SECURITY DEFINER, solo ids): el rol del worker no lee
 *   `mail_preview_requests` sin organización fijada.
 * - Leer, completar, fallar y purgar corren en una transacción corta con la organización de la fuente fijada;
 *   nunca queda una transacción abierta durante la red.
 * - El contenido se cifra con el módulo de criptografía (campo propio `mail_preview`, con el id de la petición en
 *   el AAD) antes de tocar la base, y la copia en claro que crea este adaptador se pone a cero. Nunca se
 *   registra.
 * - Solo escribe las columnas que el rol del worker tiene permitidas y solo sobre una fila todavía pendiente: si
 *   otra pasada ya la cerró, no se pisa su resultado.
 */
import type { Pool } from 'pg';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { IdGenerator } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type {
  MailPreviewFailureCode,
  MailPreviewWorkStore,
  PendingMailPreview,
} from '../application/ports/mail-preview-work-store.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';
import { mailPreviewContext } from '../domain/mail-preview.js';
import type { MailPreviewKind } from '../domain/mail-preview.js';

interface SourceRow {
  organization_id: string;
  source_id: string;
}

interface PendingRow {
  id: string;
  kind: MailPreviewKind;
  mailbox_uid_validity: string;
  mailbox_uid: string;
}

export class PgMailPreviewWorkStore implements MailPreviewWorkStore {
  constructor(
    private readonly pool: Pool,
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly cipher: SecretCipher,
    private readonly ids: IdGenerator,
  ) {}

  async listSourcesWithPending(now: Date): Promise<readonly SourceRef[]> {
    const result = await this.pool.query<SourceRow>(
      'select organization_id, source_id from auth.list_sources_with_pending_mail_previews($1)',
      [now],
    );
    return toSourceRefs(result.rows);
  }

  async listSourcesWithExpired(now: Date): Promise<readonly SourceRef[]> {
    const result = await this.pool.query<SourceRow>(
      'select organization_id, source_id from auth.list_sources_with_expired_mail_previews($1)',
      [now],
    );
    return toSourceRefs(result.rows);
  }

  listPending(source: SourceRef, limit: number, now: Date): Promise<readonly PendingMailPreview[]> {
    return this.inSource(source, async () => {
      const result = await this.transactions.current().query<PendingRow>(
        `select id, kind, mailbox_uid_validity, mailbox_uid
           from mail_preview_requests
          where organization_id = $1
            and source_id = $2
            and status = 'pending'
            and expires_at > $4
          order by expires_at, id
          limit $3`,
        [source.organizationId, source.sourceId, limit, now],
      );
      return result.rows.map((row) => ({
        requestId: row.id,
        kind: row.kind,
        mailboxUidValidity: Number(row.mailbox_uid_validity),
        mailboxUid: Number(row.mailbox_uid),
      }));
    });
  }

  complete(
    source: SourceRef,
    requestId: string,
    content: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    return this.inSource(source, async () => {
      const plaintext = new TextEncoder().encode(content);
      try {
        const sealed = await this.cipher.encrypt(
          mailPreviewContext(source.organizationId, requestId),
          plaintext,
        );
        // Un fallo del KMS o de la llave no es un mensaje malo: se propaga y la petición sigue pendiente.
        if (!sealed.ok) throw sealed.error;

        const updated = await this.transactions.current().query(
          `update mail_preview_requests
              set status = 'ready', result_code = 'READY', completed_at = $3,
                  ciphertext = $4, nonce = $5, dek_version = $6, expires_at = $7
            where organization_id = $1
              and id = $2
              and status = 'pending'
              and expires_at > $3`,
          [
            source.organizationId,
            requestId,
            now,
            Buffer.from(sealed.value.ciphertext),
            Buffer.from(sealed.value.nonce),
            sealed.value.dekVersion,
            expiresAt,
          ],
        );
        // Una petición que venció mientras se descargaba el mensaje no se revive: la purga la borrará.
        return (updated.rowCount ?? 0) > 0;
      } finally {
        plaintext.fill(0);
      }
    });
  }

  fail(
    source: SourceRef,
    requestId: string,
    code: MailPreviewFailureCode,
    now: Date,
  ): Promise<void> {
    return this.inSource(source, async () => {
      await this.transactions.current().query(
        `update mail_preview_requests
            set status = 'failed', result_code = $3, completed_at = $4
          where organization_id = $1
            and id = $2
            and status = 'pending'`,
        [source.organizationId, requestId, code, now],
      );
    });
  }

  purgeExpired(source: SourceRef, now: Date): Promise<number> {
    return this.inSource(source, async () => {
      const result = await this.transactions.current().query(
        `delete from mail_preview_requests
          where organization_id = $1
            and source_id = $2
            and expires_at <= $3`,
        [source.organizationId, source.sourceId, now],
      );
      return result.rowCount ?? 0;
    });
  }

  private inSource<T>(source: SourceRef, fn: () => Promise<T>): Promise<T> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      fn,
    );
  }
}

function toSourceRefs(rows: readonly SourceRow[]): readonly SourceRef[] {
  return rows.map((row) => ({
    organizationId: asOrganizationId(row.organization_id),
    sourceId: row.source_id,
  }));
}
