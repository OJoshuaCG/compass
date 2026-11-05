/**
 * Invariantes de seguridad
 * - Una transacción corta con la organización de la fuente fijada (aislamiento por filas).
 * - Solo plantillas vigentes: ni la plantilla ni la vista que la usa pueden estar archivadas.
 * - Una definición ilegible se omite (falla cerrado), nunca se interpreta a medias.
 */
import type { IdGenerator } from '../../../shared/kernel/index.js';
import type { TenantScope, TransactionProvider } from '../../organization/index.js';
import type { SourceTemplateStore } from '../application/ports/inbound-recorder.js';
import type { SourceRef } from '../application/ports/poll-state-store.js';
import type { InboundTemplate } from '../domain/inbound-template.js';
import { parseTemplateRow } from './template-definition.js';

interface TemplateRow {
  id: string;
  kind: string;
  definition: unknown;
}

export class PgSourceTemplateStore implements SourceTemplateStore {
  constructor(
    private readonly scope: TenantScope,
    private readonly transactions: TransactionProvider,
    private readonly ids: IdGenerator,
  ) {}

  listForSource(source: SourceRef): Promise<readonly InboundTemplate[]> {
    return this.scope.runAs(
      { organizationId: source.organizationId, actorId: null, requestId: this.ids.next() },
      async () => {
        // `distinct`: una plantilla usada por varias vistas de la misma fuente cuenta una sola vez.
        const result = await this.transactions.current().query<TemplateRow>(
          `select distinct t.id, t.kind, t.definition
             from mail_views v
             join mail_view_templates vt
               on vt.organization_id = v.organization_id and vt.view_id = v.id
             join inbound_templates t
               on t.organization_id = vt.organization_id and t.id = vt.template_id
            where v.organization_id = $1
              and v.source_id = $2
              and v.archived_at is null
              and t.archived_at is null
            order by t.id`,
          [source.organizationId, source.sourceId],
        );
        const templates: InboundTemplate[] = [];
        for (const row of result.rows) {
          const template = parseTemplateRow(row);
          if (template !== null) templates.push(template);
        }
        return templates;
      },
    );
  }
}
