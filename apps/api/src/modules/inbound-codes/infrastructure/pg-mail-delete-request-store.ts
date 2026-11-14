/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; la organización del INSERT sale
 *   de `app.org_id`, nunca de un parámetro.
 * - Solo identificadores y posiciones: ni asunto, ni remitente, ni cuerpo.
 * - Solo fuentes de correo activas: una fuente suspendida o archivada no se borra desde Compass.
 */
import type { TransactionProvider } from '../../organization/index.js';
import { asUserId } from '../../../shared/kernel/index.js';
import type {
  MailDeleteRequestStatus,
  MailDeleteRequestStore,
  MailDeleteTarget,
  NewMailDeleteRequest,
} from '../application/ports/mail-delete-request-store.js';

interface TargetRow {
  receipt_id: string;
  source_id: string;
  source_created_by: string;
  mailbox_uid_validity: string | null;
  mailbox_uid: string | null;
}

interface StatusRow {
  status: MailDeleteRequestStatus['status'];
  result_code: string | null;
  requested_at: Date;
  completed_at: Date | null;
}

/** `bigint` llega como texto desde pg; los valores caben en 32 bits (restricción de la migración). */
const toNumberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

export class PgMailDeleteRequestStore implements MailDeleteRequestStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async findTarget(receiptId: string): Promise<MailDeleteTarget | null> {
    const result = await this.transactions.current().query<TargetRow>(
      `select r.id as receipt_id, r.source_id, s.created_by as source_created_by,
              r.mailbox_uid_validity, r.mailbox_uid
         from inbound_receipts r
         join mail_sources s
           on s.organization_id = r.organization_id and s.id = r.source_id
        where r.id = $1
          and s.channel = 'mail'
          and s.status = 'active'`,
      [receiptId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      receiptId: row.receipt_id,
      sourceId: row.source_id,
      sourceCreatedBy: asUserId(row.source_created_by),
      mailboxUidValidity: toNumberOrNull(row.mailbox_uid_validity),
      mailboxUid: toNumberOrNull(row.mailbox_uid),
    };
  }

  async insertPending(request: NewMailDeleteRequest): Promise<'created' | 'already_pending'> {
    const result = await this.transactions.current().query(
      `insert into mail_delete_requests
         (organization_id, source_id, receipt_id, mailbox_uid_validity, mailbox_uid, requested_by)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4, $5)
       on conflict (organization_id, receipt_id) where status = 'pending' do nothing
       returning id`,
      [
        request.sourceId,
        request.receiptId,
        request.mailboxUidValidity,
        request.mailboxUid,
        request.requestedBy,
      ],
    );
    return result.rows.length === 1 ? 'created' : 'already_pending';
  }

  async findLatest(receiptId: string): Promise<MailDeleteRequestStatus | null> {
    const result = await this.transactions.current().query<StatusRow>(
      `select status, result_code, requested_at, completed_at
         from mail_delete_requests
        where receipt_id = $1
        order by requested_at desc, id desc
        limit 1`,
      [receiptId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      status: row.status,
      resultCode: row.result_code,
      requestedAt: row.requested_at,
      completedAt: row.completed_at,
    };
  }
}
