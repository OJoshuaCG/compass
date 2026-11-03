/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; ninguna consulta sale de ella.
 * - Solo restablecimientos (`sensitive`, `reset_code` o `reset_link`) de plantillas vigentes de la vista y de
 *   LA fuente de esa vista: una plantilla compartida entre fuentes no cruza elementos.
 * - El aviso al outbox se inserta en la misma transacción que las auditorías de la revelación y su
 *   organización sale de `app.org_id`, nunca de un parámetro. Solo ids, conteo y hora en el contenido.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  InboundResetStore,
  LiveResetRecord,
} from '../application/ports/inbound-reset-store.js';
import {
  RESET_REVEAL_NOTICE_AGGREGATE,
  RESET_REVEAL_NOTICE_EVENT_TYPE,
  serializeResetRevealNotice,
} from '../domain/reset-reveal-notice.js';
import type { ResetRevealNoticePayload } from '../domain/reset-reveal-notice.js';

interface ResetRow {
  id: string;
  kind: LiveResetRecord['kind'];
  value_type: LiveResetRecord['valueType'];
  expires_at: Date;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

export class PgInboundResetStore implements InboundResetStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async listLiveResets(
    viewId: string,
    now: Date,
    limit: number,
  ): Promise<readonly LiveResetRecord[]> {
    const result = await this.transactions.current().query<ResetRow>(
      `select i.id, i.kind, i.value_type, i.expires_at, i.ciphertext, i.nonce, i.dek_version
         from mail_views v
         join mail_view_templates vt
           on vt.organization_id = v.organization_id and vt.view_id = v.id
         join inbound_templates t
           on t.organization_id = vt.organization_id and t.id = vt.template_id
         join inbound_items i
           on i.organization_id = v.organization_id
          and i.template_id = t.id
          and i.source_id = v.source_id
        where v.id = $1
          and v.archived_at is null
          and t.archived_at is null
          and i.kind in ('reset_code', 'reset_link')
          and i.visibility = 'sensitive'
          and i.expires_at > $2
        order by i.created_at desc, i.id desc
        limit $3`,
      [viewId, now, limit],
    );
    return result.rows.map((row) => ({
      itemId: row.id,
      kind: row.kind,
      valueType: row.value_type,
      expiresAt: row.expires_at,
      ciphertext: new Uint8Array(row.ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
    }));
  }

  async enqueueRevealNotice(notice: ResetRevealNoticePayload): Promise<void> {
    await this.transactions.current().query(
      `insert into outbox_events (organization_id, aggregate, type, payload)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3::jsonb)`,
      [
        RESET_REVEAL_NOTICE_AGGREGATE,
        RESET_REVEAL_NOTICE_EVENT_TYPE,
        JSON.stringify(serializeResetRevealNotice(notice)),
      ],
    );
  }
}
