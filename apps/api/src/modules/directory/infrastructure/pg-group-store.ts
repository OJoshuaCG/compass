/**
 * Almacén de grupos y membresías sobre PostgreSQL.
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización, que sale de `app.org_id`,
 *   nunca de un parámetro.
 * - El nombre vivo es único por organización sin distinguir mayúsculas (índice parcial); aquí un choque se
 *   resuelve con `on conflict do nothing`, sin abortar la transacción.
 */
import type { GroupMemberRole } from '@iam/contracts';

import type { TransactionProvider } from '../../organization/index.js';
import type {
  GroupMemberRow,
  GroupStore,
  GroupSummaryRow,
} from '../application/ports/group-store.js';
import type { GroupRecord } from '../domain/group-policy.js';

interface GroupRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_by: string;
  readonly created_at: Date;
}

interface GroupSummaryDbRow extends GroupRow {
  readonly member_count: string;
  readonly viewer_role: GroupMemberRole | null;
}

interface MemberDbRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly role: GroupMemberRole;
  readonly created_at: Date;
}

const toRecord = (row: GroupRow): GroupRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

export class PgGroupStore implements GroupStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async insertGroup(input: {
    readonly name: string;
    readonly description: string | null;
    readonly createdBy: string;
  }): Promise<GroupRecord | null> {
    const result = await this.transactions.current().query<GroupRow>(
      `insert into groups (organization_id, name, description, created_by)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3)
       on conflict do nothing
       returning id, name, description, created_by, created_at`,
      [input.name, input.description, input.createdBy],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findLiveForUpdate(groupId: string): Promise<GroupRecord | null> {
    const result = await this.transactions.current().query<GroupRow>(
      `select id, name, description, created_by, created_at
         from groups
        where id = $1 and archived_at is null
        for update`,
      [groupId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async findLive(groupId: string): Promise<GroupRecord | null> {
    const result = await this.transactions.current().query<GroupRow>(
      `select id, name, description, created_by, created_at
         from groups
        where id = $1 and archived_at is null`,
      [groupId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async listLive(input: {
    readonly viewerId: string;
    readonly onlyOfViewer: boolean;
    readonly onlyManagedByViewer: boolean;
  }): Promise<readonly GroupSummaryRow[]> {
    const result = await this.transactions.current().query<GroupSummaryDbRow>(
      `select g.id, g.name, g.description, g.created_by, g.created_at,
              (select count(*) from group_memberships m where m.group_id = g.id) as member_count,
              own.role as viewer_role
         from groups g
         left join group_memberships own on own.group_id = g.id and own.user_id = $1
        where g.archived_at is null
          and ($2::boolean = false or own.user_id is not null)
          and ($3::boolean = false or own.role = 'manager')
        order by lower(g.name), g.id`,
      [input.viewerId, input.onlyOfViewer, input.onlyManagedByViewer],
    );
    return result.rows.map((row) => ({
      ...toRecord(row),
      memberCount: Number(row.member_count),
      roleOfViewer: row.viewer_role,
    }));
  }

  async roleOf(groupId: string, userId: string): Promise<GroupMemberRole | null> {
    const result = await this.transactions
      .current()
      .query<{ role: GroupMemberRole }>(
        'select role from group_memberships where group_id = $1 and user_id = $2',
        [groupId, userId],
      );
    return result.rows[0]?.role ?? null;
  }

  async listMembers(groupId: string): Promise<readonly GroupMemberRow[]> {
    const result = await this.transactions.current().query<MemberDbRow>(
      `select m.user_id, u.display_name, m.role, m.created_at
         from group_memberships m
         join users u on u.organization_id = m.organization_id and u.id = m.user_id
        where m.group_id = $1
        order by (m.role = 'manager') desc, lower(u.display_name), m.user_id`,
      [groupId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      addedAt: row.created_at,
    }));
  }

  async addMember(input: {
    readonly groupId: string;
    readonly userId: string;
    readonly role: GroupMemberRole;
    readonly addedBy: string;
  }): Promise<boolean> {
    const result = await this.transactions.current().query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, $3, $4)
       on conflict (organization_id, group_id, user_id) do nothing`,
      [input.groupId, input.userId, input.role, input.addedBy],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.transactions
      .current()
      .query('delete from group_memberships where group_id = $1 and user_id = $2', [
        groupId,
        userId,
      ]);
  }

  async countManagers(groupId: string): Promise<number> {
    const result = await this.transactions
      .current()
      .query<{ total: string }>(
        `select count(*) as total from group_memberships where group_id = $1 and role = 'manager'`,
        [groupId],
      );
    return Number(result.rows[0]?.total ?? 0);
  }
}
