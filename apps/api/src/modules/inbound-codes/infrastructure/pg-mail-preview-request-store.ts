/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; la organización del INSERT sale
 *   de `app.org_id`, nunca de un parámetro.
 * - Cada petición es de quien la pidió: consultar y entregar siempre filtran por `requested_by`, así una persona
 *   nunca consume ni ve el estado de lo que pidió otra.
 * - Esta clase no descifra: entrega el texto cifrado al caso de uso, que lo abre con el módulo de criptografía.
 * - Nada de lo que se consulta aquí se registra: ni el texto cifrado ni el estado se escriben en logs.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { MailPreviewKind } from '../domain/mail-preview.js';
import type {
  MailPreviewRequestStatus,
  MailPreviewRequestStore,
  NewMailPreviewRequest,
  ReadyMailPreview,
} from '../application/ports/mail-preview-request-store.js';

interface StatusRow {
  status: MailPreviewRequestStatus['status'];
  result_code: MailPreviewRequestStatus['resultCode'];
  requested_at: Date;
}

interface ReadyRow {
  id: string;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

export class PgMailPreviewRequestStore implements MailPreviewRequestStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async insertPending(
    request: NewMailPreviewRequest,
    now: Date,
  ): Promise<'created' | 'already_pending'> {
    const executor = this.transactions.current();
    // Una fila viva pero vencida (el worker aún no la purgó) no debe bloquear una petición nueva.
    await executor.query(
      `delete from mail_preview_requests
        where receipt_id = $1 and kind = $2 and requested_by = $4 and expires_at <= $3`,
      [request.receiptId, request.kind, now, request.requestedBy],
    );
    const result = await executor.query(
      `insert into mail_preview_requests
         (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, kind,
          requested_by, requested_at, expires_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (organization_id, receipt_id, kind, requested_by) where status <> 'failed' do nothing
       returning id`,
      [
        request.sourceId,
        request.receiptId,
        request.mailboxUidValidity,
        request.mailboxUid,
        request.kind,
        request.requestedBy,
        now,
        request.expiresAt,
      ],
    );
    return result.rows.length === 1 ? 'created' : 'already_pending';
  }

  async findLatest(
    receiptId: string,
    kind: MailPreviewKind,
    requestedBy: UserId,
    now: Date,
  ): Promise<MailPreviewRequestStatus | null> {
    const result = await this.transactions.current().query<StatusRow>(
      `select status, result_code, requested_at
         from mail_preview_requests
        where receipt_id = $1 and kind = $2 and requested_by = $4 and expires_at > $3
        order by requested_at desc, id desc
        limit 1`,
      [receiptId, kind, now, requestedBy],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { status: row.status, resultCode: row.result_code, requestedAt: row.requested_at };
  }

  async takeReady(
    receiptId: string,
    kind: MailPreviewKind,
    requestedBy: UserId,
    now: Date,
  ): Promise<ReadyMailPreview | null> {
    // Leer y borrar en una sola sentencia: dos lecturas simultáneas no entregan el mismo contenido dos veces
    // (la segunda espera a la primera y ya no encuentra la fila). `iam_app` no tiene UPDATE, así que no se
    // usa `for update`.
    const result = await this.transactions.current().query<ReadyRow>(
      `delete from mail_preview_requests
        where id = (
          select id from mail_preview_requests
           where receipt_id = $1 and kind = $2 and requested_by = $4
             and status = 'ready' and expires_at > $3
           order by requested_at desc, id desc
           limit 1
        )
          and status = 'ready'
       returning id, ciphertext, nonce, dek_version`,
      [receiptId, kind, now, requestedBy],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      requestId: row.id,
      ciphertext: new Uint8Array(row.ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
    };
  }
}
