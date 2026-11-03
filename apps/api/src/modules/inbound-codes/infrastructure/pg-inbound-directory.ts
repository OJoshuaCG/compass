/**
 * Invariantes de seguridad
 * - Corre en la transacción del llamador, con la organización fijada por RLS; ninguna consulta sale de ella.
 * - Solo se lista lo que la persona alcanza por `effective_access` (compartición directa o de grupo, la
 *   mayor): quien no tiene nivel no sabe que el recurso existe.
 * - Una vista solo se lista si hoy se puede leer: el mismo filtro que `PgInboundViewReader.findLiveView`.
 * - El listado de vistas no lleva la dirección de la fuente ni la cuenta ligada.
 * - Las plantillas son configuración de la organización, no un recurso compartido: se listan las vigentes,
 *   las mismas que una vista puede referenciar. Nunca se entrega su definición.
 */
import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  ConfigurableSourceSummary,
  ConfigurableViewSummary,
  InboundDirectory,
  ReadableViewSummary,
  TemplateSummary,
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

interface ConfigurableViewRow {
  id: string;
  source_id: string;
  name: string;
  template_ids: string[];
  created_at: Date;
  level: ShareLevel;
}

interface TemplateRow {
  id: string;
  name: string;
  kind: TemplateSummary['kind'];
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

  async listConfigurableViews(
    userId: UserId,
    limit: number,
  ): Promise<readonly ConfigurableViewSummary[]> {
    // Las plantillas se agregan en una subconsulta correlacionada para que el límite cuente vistas, no
    // filas de la unión con sus plantillas.
    const result = await this.transactions.current().query<ConfigurableViewRow>(
      `select v.id, v.source_id, v.name, v.created_at, ea.level,
              coalesce(
                (select array_agg(vt.template_id order by vt.template_id)
                   from mail_view_templates vt
                  where vt.organization_id = v.organization_id and vt.view_id = v.id),
                '{}'::uuid[]
              ) as template_ids
         from effective_access ea
         join mail_views v
           on v.organization_id = ea.organization_id and v.id = ea.resource_id
         join mail_sources s
           on s.organization_id = v.organization_id and s.id = v.source_id
        where ea.resource_type = 'mail_view'
          and ea.user_id = $1
          and v.archived_at is null
          and s.status <> 'archived'
        order by v.name, v.id
        limit $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      templateIds: row.template_ids,
      createdAt: row.created_at,
      level: row.level,
    }));
  }

  async listLiveTemplates(limit: number): Promise<readonly TemplateSummary[]> {
    const result = await this.transactions.current().query<TemplateRow>(
      `select t.id, t.name, t.kind
         from inbound_templates t
        where t.archived_at is null
        order by t.name, t.id
        limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind }));
  }
}
