/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización fijada por el barrido
 *   (`TenantScope.runAs`); el SQL no recibe la organización como argumento.
 * - Aquí no hay secretos: solo ids y fechas. El URI del segundo factor vive cifrado en `credential_secrets`
 *   y esta consulta nunca lo toca.
 * - Las consultas llevan parámetros enlazados; ningún valor se compone en el SQL.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { PendingTotpNoticeStore } from '../application/ports/pending-totp-notice-store.js';
import {
  PENDING_TOTP_NOTICE_AGGREGATE,
  PENDING_TOTP_NOTICE_EVENT_TYPE,
  serializePendingTotpNotice,
} from '../domain/pending-totp-notice.js';
import type { DuePendingTotp } from '../domain/pending-totp-notice.js';

interface DuePendingTotpRow {
  credential_id: string;
  registered_by: string;
  registered_at: Date;
}

export class PgPendingTotpNoticeStore implements PendingTotpNoticeStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async claimDue(
    registeredBefore: Date,
    noticeAt: Date,
    limit: number,
  ): Promise<readonly DuePendingTotp[]> {
    // El índice parcial `credential_totp_org_pending` (organización, `registered_at`, donde `status = 'pending'`)
    // cubre la búsqueda. Se salta lo ya bloqueado: un confirmar o un re-registro en curso no se espera.
    // Tras esperar un bloqueo PostgreSQL vuelve a evaluar el filtro, así que un registro confirmado
    // entre tanto ya no se reclama.
    const result = await this.transactions.current().query<DuePendingTotpRow>(
      `update credential_totp
          set pending_notice_at = $2
        where id in (
          select t.id
            from credential_totp t
            join credentials c
              on c.organization_id = t.organization_id
             and c.id = t.credential_id
           where t.status = 'pending'
             and t.pending_notice_at is null
             and t.registered_at <= $1
             and c.archived_at is null
           order by t.registered_at
           limit $3
             for update of t skip locked
        )
        returning credential_id, registered_by, registered_at`,
      [registeredBefore, noticeAt, limit],
    );
    return result.rows.map((row) => ({
      credentialId: row.credential_id,
      registeredBy: row.registered_by,
      registeredAt: row.registered_at,
    }));
  }

  async enqueue(notice: DuePendingTotp): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        PENDING_TOTP_NOTICE_AGGREGATE,
        PENDING_TOTP_NOTICE_EVENT_TYPE,
        // Solo ids y una fecha: el manejador resuelve nombre y destinataria al enviar.
        JSON.stringify(serializePendingTotpNotice(notice)),
      ],
    );
  }
}
