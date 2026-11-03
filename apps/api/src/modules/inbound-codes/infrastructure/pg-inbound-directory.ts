/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; ninguna consulta sale de ella.
 * - Solo se lista lo que la persona alcanza por `effective_access` (compartición directa o de grupo, la
 *   mayor): quien no tiene nivel no sabe que el recurso existe.
 * - Una vista solo se lista si hoy se puede leer: el mismo filtro que `PgInboundViewReader.findLiveView`.
 * - El listado de vistas no lleva la dirección de la fuente ni la cuenta ligada.
 */
import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  ConfigurableSourceSummary,
  InboundDirectory,
  ReadableViewSummary,
} from '../application/ports/inbound-directory.js';

interface ViewSummaryRow {
  id: string;
  name: string;
  source_id: string;
  source_display_name: string;
  channel: ReadableViewSummary['channel'];
  level: ShareLevel;
}

interface SourceSummaryRow {
  id: string;
  channel: ConfigurableSourceSummary['channel'];
  address: string;
  display_name: string;
  account_id: string | null;
  status: ConfigurableSourceSummary['status'];
  created_at: Date;
  level: ShareLevel;
}

export class PgInboundDirectory implements InboundDirectory {
  constructor(private readonly transactions: TransactionProvider) {}

  async listReadableViews(userId: UserId, limit: number): Promise<readonly ReadableViewSummary[]> {
    const result = await this.transactions.current().query<ViewSummaryRow>(
      `select v.id, v.name, v.source_id, s.display_name as source_display_name, s.channel, ea.level
         from effective_access ea
         join mail_views v
           on v.organization_id = ea.organization_id and v.id = ea.resource_id
         join mail_sources s
           on s.organization_id = v.organization_id and s.id = v.source_id
         left join accounts a
           on a.organization_id = s.organization_id and a.id = s.account_id
        where ea.resource_type = 'mail_view'
          and ea.user_id = $1
          and v.archived_at is null
          and s.status = 'active'
          and (s.account_id is null or a.status = 'active')
        order by v.name, v.id
        limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceId: row.source_id,
      sourceDisplayName: row.source_display_name,
      channel: row.channel,
      level: row.level,
    }));
  }

  async listConfigurableSources(
    userId: UserId,
    limit: number,
  ): Promise<readonly ConfigurableSourceSummary[]> {
    const result = await this.transactions.current().query<SourceSummaryRow>(
      `select s.id, s.channel, s.address, s.display_name, s.account_id, s.status, s.created_at, ea.level
         from effective_access ea
         join mail_sources s
           on s.organization_id = ea.organization_id and s.id = ea.resource_id
        where ea.resource_type = 'mail_source'
          and ea.user_id = $1
          and s.status <> 'archived'
        order by s.display_name, s.id
        limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      address: row.address,
      displayName: row.display_name,
      accountId: row.account_id,
      status: row.status,
      createdAt: row.created_at,
      level: row.level,
    }));
  }
}
