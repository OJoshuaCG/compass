/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita fuentes, vistas, plantillas y comparticiones a la
 *   organización. Ninguna consulta compone SQL con valores recibidos: todo va enlazado.
 * - Nada se borra: archivar marca `archived_at` y las comparticiones se revocan (`revoked_at`), porque quién
 *   tuvo acceso y cuándo es dato forense. Solo la relación vista-plantilla se reescribe.
 * - Un duplicado (dirección de fuente, nombre de vista) es un resultado esperado y no debe abortar la
 *   transacción: se atrapa con un punto de guardado.
 * - `address` y `channel` no se pueden modificar con el rol de la aplicación (sin `update` sobre ellas).
 */
import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type {
  ConfigurableResource,
  InboundConfigurationRepository,
  InboundSourceStatus,
  NewSource,
  NewView,
  SourceRecord,
  TemplateChange,
  ViewRecord,
} from '../application/ports/inbound-configuration-repository.js';

const UNIQUE_VIOLATION = '23505';

interface SourceRow {
  id: string;
  channel: 'mail' | 'sms';
  address: string;
  display_name: string;
  account_id: string | null;
  status: InboundSourceStatus;
  created_at: Date;
}

interface ViewRow {
  id: string;
  source_id: string;
  name: string;
  created_at: Date;
}

const SOURCE_COLUMNS = 'id, channel, address, display_name, account_id, status, created_at';

const toSource = (row: SourceRow): SourceRecord => ({
  id: row.id,
  channel: row.channel,
  address: row.address,
  displayName: row.display_name,
  accountId: row.account_id,
  status: row.status,
  createdAt: row.created_at,
});

export class PgInboundConfigurationRepository implements InboundConfigurationRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async findSourceForUpdate(sourceId: string): Promise<SourceRecord | null> {
    const result = await this.transactions.current().query<SourceRow>(
      `select ${SOURCE_COLUMNS}
         from mail_sources
        where id = $1 and status <> 'archived'
        for update`,
      [sourceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toSource(row);
  }

  async findSource(sourceId: string): Promise<SourceRecord | null> {
    const result = await this.transactions
      .current()
      .query<SourceRow>(`select ${SOURCE_COLUMNS} from mail_sources where id = $1`, [sourceId]);
    const row = result.rows[0];
    return row === undefined ? null : toSource(row);
  }

  async findViewForUpdate(viewId: string): Promise<ViewRecord | null> {
    const client = this.transactions.current();
    // Orden de bloqueo fijo: primero la fuente y luego la vista, el mismo que sigue `archiveSource`. Con un solo
    // `for update of v, s` el orden dependía del plan de consulta y dos transacciones podían cruzarse (40P01).
    const source = await client.query(
      `select s.id
         from mail_sources s
         join mail_views v
           on v.organization_id = s.organization_id and v.source_id = s.id
        where v.id = $1
          and v.archived_at is null
          and s.status <> 'archived'
        for update of s`,
      [viewId],
    );
    if (source.rows.length === 0) return null;
    const result = await client.query<ViewRow>(
      `select id, source_id, name, created_at
         from mail_views
        where id = $1 and archived_at is null
        for update`,
      [viewId],
    );
    const row = result.rows[0];
    return row === undefined ? null : await this.withTemplates(row);
  }

  async findView(viewId: string): Promise<ViewRecord | null> {
    const result = await this.transactions
      .current()
      .query<ViewRow>(
        'select id, source_id, name, created_at from mail_views where id = $1 and archived_at is null',
        [viewId],
      );
    const row = result.rows[0];
    return row === undefined ? null : await this.withTemplates(row);
  }

  async resourceLevel(
    resourceType: ConfigurableResource,
    resourceId: string,
    userId: UserId,
  ): Promise<ShareLevel | null> {
    const result = await this.transactions.current().query<{ level: ShareLevel }>(
      `select level
         from effective_access
        where resource_type = $1 and resource_id = $2 and user_id = $3`,
      [resourceType, resourceId, userId],
    );
    return result.rows[0]?.level ?? null;
  }

  async accountIsActive(accountId: string): Promise<boolean> {
    const result = await this.transactions
      .current()
      .query("select 1 from accounts where id = $1 and status = 'active'", [accountId]);
    return result.rows.length > 0;
  }

  async lockAccountForShare(accountId: string): Promise<void> {
    await this.transactions
      .current()
      .query('select 1 from accounts where id = $1 for share', [accountId]);
  }

  async accountLevel(accountId: string, userId: UserId): Promise<ShareLevel | null> {
    const result = await this.transactions.current().query<{ level: ShareLevel }>(
      `select level
         from effective_access
        where resource_type = 'account' and resource_id = $1 and user_id = $2`,
      [accountId, userId],
    );
    return result.rows[0]?.level ?? null;
  }

  async countLiveTemplates(templateIds: readonly string[]): Promise<number> {
    const result = await this.transactions.current().query<{ total: string }>(
      // `for share` impide que una plantilla se archive entre esta cuenta y la confirmación de la vista.
      `select count(*)::text as total
         from (
           select id
             from inbound_templates
            where id = any($1::uuid[]) and archived_at is null
              for share
         ) as live_templates`,
      [[...templateIds]],
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async insertSource(source: NewSource): Promise<'inserted' | 'address_taken'> {
    const client = this.transactions.current();
    // Punto de guardado: una dirección repetida es un resultado esperado y no debe abortar la transacción.
    await client.query('savepoint insert_mail_source');
    try {
      await client.query(
        `insert into mail_sources (id, organization_id, channel, address, display_name, account_id, created_by)
         values ($1, nullif(current_setting('app.org_id', true), '')::uuid, 'mail', $2, $3, $4, $5)`,
        [source.id, source.address, source.displayName, source.accountId, source.createdBy],
      );
      await client.query('release savepoint insert_mail_source');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_mail_source');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'address_taken';
      throw error;
    }
  }

  async updateSource(
    sourceId: string,
    edit: { readonly displayName: string; readonly accountId: string | null },
  ): Promise<SourceRecord> {
    const result = await this.transactions.current().query<SourceRow>(
      `update mail_sources
          set display_name = $2, account_id = $3, version = version + 1
        where id = $1
        returning ${SOURCE_COLUMNS}`,
      [sourceId, edit.displayName, edit.accountId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('The source just locked was not found');
    return toSource(row);
  }

  async archiveSource(
    sourceId: string,
    at: Date,
    revokedBy: UserId,
  ): Promise<{ readonly revokedShares: number }> {
    const client = this.transactions.current();
    await client.query(
      `update mail_views set archived_at = $2, version = version + 1
        where source_id = $1 and archived_at is null`,
      [sourceId, at],
    );
    await client.query(
      `update mail_sources set status = 'archived', archived_at = $2, version = version + 1
        where id = $1`,
      [sourceId, at],
    );
    const revoked = await client.query(
      `update shares
          set revoked_at = $2, revoked_by = $3
        where revoked_at is null
          and ((resource_type = 'mail_source' and resource_id = $1)
            or (resource_type = 'mail_view'
                and resource_id in (select id from mail_views where source_id = $1)))`,
      [sourceId, at, revokedBy],
    );
    return { revokedShares: revoked.rowCount ?? 0 };
  }

  async insertView(view: NewView): Promise<'inserted' | 'name_taken'> {
    const client = this.transactions.current();
    await client.query('savepoint insert_mail_view');
    try {
      await client.query(
        `insert into mail_views (id, organization_id, source_id, name, created_by)
         values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4)`,
        [view.id, view.sourceId, view.name, view.createdBy],
      );
      await client.query('release savepoint insert_mail_view');
      return 'inserted';
    } catch (error) {
      await client.query('rollback to savepoint insert_mail_view');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'name_taken';
      throw error;
    }
  }

  async renameView(viewId: string, name: string): Promise<'renamed' | 'name_taken'> {
    const client = this.transactions.current();
    await client.query('savepoint rename_mail_view');
    try {
      await client.query('update mail_views set name = $2, version = version + 1 where id = $1', [
        viewId,
        name,
      ]);
      await client.query('release savepoint rename_mail_view');
      return 'renamed';
    } catch (error) {
      await client.query('rollback to savepoint rename_mail_view');
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'name_taken';
      throw error;
    }
  }

  async replaceTemplates(viewId: string, templateIds: readonly string[]): Promise<TemplateChange> {
    const client = this.transactions.current();
    const wanted = [...new Set(templateIds)];
    const removed = await client.query(
      `delete from mail_view_templates
        where view_id = $1 and not (template_id = any($2::uuid[]))`,
      [viewId, wanted],
    );
    const added = await client.query(
      `insert into mail_view_templates (organization_id, view_id, template_id)
       select nullif(current_setting('app.org_id', true), '')::uuid, $1, wanted.template_id
         from unnest($2::uuid[]) as wanted(template_id)
       on conflict do nothing`,
      [viewId, wanted],
    );
    return { added: added.rowCount ?? 0, removed: removed.rowCount ?? 0 };
  }

  async archiveView(
    viewId: string,
    at: Date,
    revokedBy: UserId,
  ): Promise<{ readonly revokedShares: number }> {
    const client = this.transactions.current();
    await client.query(
      'update mail_views set archived_at = $2, version = version + 1 where id = $1',
      [viewId, at],
    );
    const revoked = await client.query(
      `update shares set revoked_at = $2, revoked_by = $3
        where resource_type = 'mail_view' and resource_id = $1 and revoked_at is null`,
      [viewId, at, revokedBy],
    );
    return { revokedShares: revoked.rowCount ?? 0 };
  }

  async insertManageShare(input: {
    readonly id: string;
    readonly resourceType: ConfigurableResource;
    readonly resourceId: string;
    readonly userId: UserId;
  }): Promise<void> {
    await this.transactions.current().query(
      `insert into shares (id, organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, 'user', $4, 'MANAGE', $4)`,
      [input.id, input.resourceType, input.resourceId, input.userId],
    );
  }

  private async withTemplates(row: ViewRow): Promise<ViewRecord> {
    const templates = await this.transactions
      .current()
      .query<{ template_id: string }>(
        'select template_id from mail_view_templates where view_id = $1 order by template_id',
        [row.id],
      );
    return {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      templateIds: templates.rows.map((template) => template.template_id),
      createdAt: row.created_at,
    };
  }
}
