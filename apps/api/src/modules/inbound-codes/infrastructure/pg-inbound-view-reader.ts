/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; ninguna consulta sale de ella.
 * - Una plantilla es de la organización y puede estar en vistas de fuentes distintas: todo vínculo con
 *   una vista exige además que el elemento o la recepción sea de LA fuente de esa vista.
 * - Solo `login_code` visible con USE; un restablecimiento y la cuarentena no se devuelven nunca aquí.
 * - Lo vencido no se devuelve aunque la purga no haya corrido.
 */
import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  InboundViewReader,
  LiveLoginCodeRecord,
  ReadableView,
  ReceiptHistoryRecord,
} from '../application/ports/inbound-view-reader.js';
import type { HistoryCursor } from '../domain/history-cursor.js';

interface ViewRow {
  id: string;
  source_id: string;
}

interface CodeRow {
  id: string;
  created_at: Date;
  expires_at: Date;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

interface ReceiptRow {
  id: string;
  received_at: Date;
  signing_domain: string | null;
  template_kind: ReceiptHistoryRecord['templateKind'];
}

export class PgInboundViewReader implements InboundViewReader {
  constructor(private readonly transactions: TransactionProvider) {}

  async findLiveView(viewId: string): Promise<ReadableView | null> {
    const result = await this.transactions.current().query<ViewRow>(
      `select v.id, v.source_id
         from mail_views v
         join mail_sources s
           on s.organization_id = v.organization_id and s.id = v.source_id
         left join accounts a
           on a.organization_id = s.organization_id and a.id = s.account_id
        where v.id = $1
          and v.archived_at is null
          and s.status = 'active'
          and (s.account_id is null or a.status = 'active')`,
      [viewId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, sourceId: row.source_id };
  }

  async effectiveLevel(viewId: string, userId: UserId): Promise<ShareLevel | null> {
    const result = await this.transactions.current().query<{ level: ShareLevel }>(
      `select level
         from effective_access
        where resource_type = 'mail_view' and resource_id = $1 and user_id = $2`,
      [viewId, userId],
    );
    return result.rows[0]?.level ?? null;
  }

  async listLiveLoginCodes(
    viewId: string,
    now: Date,
    limit: number,
  ): Promise<readonly LiveLoginCodeRecord[]> {
    const result = await this.transactions.current().query<CodeRow>(
      `select i.id, i.created_at, i.expires_at, i.ciphertext, i.nonce, i.dek_version
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
          and i.kind = 'login_code'
          and i.visibility = 'visible_with_use'
          and i.expires_at > $2
        order by i.created_at desc, i.id desc
        limit $3`,
      [viewId, now, limit],
    );
    return result.rows.map((row) => ({
      itemId: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ciphertext: new Uint8Array(row.ciphertext),
      nonce: new Uint8Array(row.nonce),
      dekVersion: row.dek_version,
    }));
  }

  async listHistory(
    viewId: string,
    page: { readonly limit: number; readonly after: HistoryCursor | null },
  ): Promise<readonly ReceiptHistoryRecord[]> {
    const result = await this.transactions.current().query<ReceiptRow>(
      `select r.id, r.received_at, r.signing_domain, r.template_kind
         from mail_views v
         join mail_view_templates vt
           on vt.organization_id = v.organization_id and vt.view_id = v.id
         join inbound_receipts r
           on r.organization_id = v.organization_id
          and r.template_id = vt.template_id
          and r.source_id = v.source_id
        where v.id = $1
          and v.archived_at is null
          and r.outcome = 'accepted'
          and ($2::timestamptz is null or (r.received_at, r.id) < ($2::timestamptz, $3::uuid))
        order by r.received_at desc, r.id desc
        limit $4`,
      [viewId, page.after?.receivedAt ?? null, page.after?.id ?? null, page.limit],
    );
    return result.rows.map((row) => ({
      receiptId: row.id,
      receivedAt: row.received_at,
      signingDomain: row.signing_domain,
      templateKind: row.template_kind,
    }));
  }

  async lockItemRead(userId: UserId, itemId: string): Promise<void> {
    await this.transactions
      .current()
      .query(
        "select pg_advisory_xact_lock(hashtextextended('inbound-read:' || current_setting('app.org_id', true) || ':' || $1::text || ':' || $2::text, 0))",
        [userId, itemId],
      );
  }
}
