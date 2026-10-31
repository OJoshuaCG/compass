import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant } from './helpers.js';
import type { Tenant } from './helpers.js';

let app: Client;
let tenant: Tenant;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  tenant = await seedTenant(db.appUrl, db.adminUrl, 'ceiling');
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await app.end();
});

const insertRole =
  'insert into roles (organization_id, name, permissions, created_by) values ($1, $2, $3::text[], $4) returning id';
const assignRole =
  'insert into user_roles (organization_id, user_id, role_id, granted_by) values ($1, $2, $3, $4)';

// SQLSTATE and constraint name together: 23514 alone (check_violation) could come from any other
// check, so a rejection only counts when it is the one raised by the rank ceiling trigger.
const REJECTED_BY_CEILING = '23514:user_roles_rank_ceiling';
const ACCEPTED = 'none';

async function outcomeOf(sql: string, params: unknown[]): Promise<string> {
  try {
    await inOrg(app, tenant.orgId, () => app.query(sql, params));
    return ACCEPTED;
  } catch (error) {
    const failure = error as { code?: string; constraint?: string };
    return `${failure.code ?? 'unknown'}:${failure.constraint ?? ''}`;
  }
}

async function createRole(name: string, permissions: string[]): Promise<string> {
  return inOrg(app, tenant.orgId, async () => {
    const { rows } = await app.query<{ id: string }>(insertRole, [
      tenant.orgId,
      name,
      permissions,
      tenant.rootId,
    ]);
    const row = rows[0];
    if (row === undefined) throw new Error(`role ${name} was not created`);
    return row.id;
  });
}

async function assignmentOutcome(userId: string, roleId: string): Promise<string> {
  return outcomeOf(assignRole, [tenant.orgId, userId, roleId, tenant.rootId]);
}

describe('user_roles rank ceiling (ADR 0012)', () => {
  it('rejects a role whose permission has a lower ceiling than the rank of the user', async () => {
    // Operator is rank 3 and role.manage has ceiling 1.
    const roleId = await createRole('Manage roles', ['role.manage']);
    expect(await assignmentOutcome(tenant.operatorId, roleId)).toBe(REJECTED_BY_CEILING);
  });

  it('rejects the whole role when only one of its permissions exceeds the ceiling', async () => {
    const roleId = await createRole('Mixed', ['account.create', 'user.invite']);
    expect(await assignmentOutcome(tenant.operatorId, roleId)).toBe(REJECTED_BY_CEILING);
  });

  it('allows a role whose permissions are all within the ceiling of the user', async () => {
    const roleId = await createRole('Field work', ['credential.use_totp', 'share.manage']);
    expect(await assignmentOutcome(tenant.operatorId, roleId)).toBe(ACCEPTED);
  });

  it('allows an Administrator (rank 1) to hold role.manage but not org.settings (ceiling 0)', async () => {
    const manageRoles = await createRole('Admin manage roles', ['role.manage']);
    expect(await assignmentOutcome(tenant.adminId, manageRoles)).toBe(ACCEPTED);
    const settings = await createRole('Admin settings', ['org.settings']);
    expect(await assignmentOutcome(tenant.adminId, settings)).toBe(REJECTED_BY_CEILING);
  });

  it('allows the Root (rank 0) to hold every permission', async () => {
    const roleId = await createRole('Root everything', ['org.settings', 'role.manage']);
    expect(await assignmentOutcome(tenant.rootId, roleId)).toBe(ACCEPTED);
  });

  it('allows a role without permissions', async () => {
    const roleId = await createRole('Empty', []);
    expect(await assignmentOutcome(tenant.operatorId, roleId)).toBe(ACCEPTED);
  });

  it('fails closed on a permission that is not in the catalog', async () => {
    const roleId = await createRole('Unknown permission', ['made.up']);
    expect(await assignmentOutcome(tenant.rootId, roleId)).toBe(REJECTED_BY_CEILING);
  });

  it('fails closed when the user or the role does not exist, without relying on the foreign keys', async () => {
    const roleId = await createRole('Missing user', ['account.create']);
    const missingId = '00000000-0000-7000-8000-000000000000';
    expect(await assignmentOutcome(missingId, roleId)).toBe(REJECTED_BY_CEILING);
    expect(await assignmentOutcome(tenant.rootId, missingId)).toBe(REJECTED_BY_CEILING);
  });

  it('also checks an update that moves an assignment to another user or role', async () => {
    const manageRoles = await createRole('Move to operator', ['role.manage']);
    expect(await assignmentOutcome(tenant.adminId, manageRoles)).toBe(ACCEPTED);
    const movedToOperator = await outcomeOf(
      'update user_roles set user_id = $2 where organization_id = $1 and user_id = $3 and role_id = $4',
      [tenant.orgId, tenant.operatorId, tenant.adminId, manageRoles],
    );
    expect(movedToOperator).toBe(REJECTED_BY_CEILING);

    const harmless = await createRole('Move target', ['account.create']);
    expect(await assignmentOutcome(tenant.operatorId, harmless)).toBe(ACCEPTED);
    const swappedToManage = await outcomeOf(
      'update user_roles set role_id = $2 where organization_id = $1 and user_id = $3 and role_id = $4',
      [tenant.orgId, manageRoles, tenant.operatorId, harmless],
    );
    expect(swappedToManage).toBe(REJECTED_BY_CEILING);
  });

  // SENSIBLE (revisión humana): el permiso nuevo de la migración 0021 debe existir en el catálogo de
  // la base (si no, nadie podría tenerlo: falla cerrado) y tener el mismo techo que credential.update.
  it('knows credential.restore_version with the same ceiling as credential.update (migration 0021)', async () => {
    const { rows } = await app.query<{ restore: number | null; update: number | null }>(
      "select permission_rank_ceiling('credential.restore_version') as restore, permission_rank_ceiling('credential.update') as update",
    );
    expect(rows[0]?.restore).toBe(3);
    expect(rows[0]?.update).toBe(3);

    const roleId = await createRole('Restore versions', ['credential.restore_version']);
    expect(await assignmentOutcome(tenant.operatorId, roleId)).toBe(ACCEPTED);
  });

  // SENSIBLE (revisión humana): los tres permisos de códigos entrantes (migración 0023) deben existir en
  // el catálogo de la base con su techo; ver restablecimientos (techo 1) jamás llega a un Operador.
  it('knows the inbound permissions with their ceilings (migration 0023)', async () => {
    const { rows } = await app.query<{
      read: number | null;
      configure: number | null;
      reveal: number | null;
    }>(
      "select permission_rank_ceiling('inbound.read_codes') as read, permission_rank_ceiling('inbound.configure') as configure, permission_rank_ceiling('inbound.reveal_reset') as reveal",
    );
    expect(rows[0]?.read).toBe(3);
    expect(rows[0]?.configure).toBe(2);
    expect(rows[0]?.reveal).toBe(1);

    const readCodes = await createRole('Read codes', ['inbound.read_codes']);
    const configure = await createRole('Configure inbound', ['inbound.configure']);
    const revealReset = await createRole('Reveal resets', ['inbound.reveal_reset']);
    expect(await assignmentOutcome(tenant.operatorId, readCodes)).toBe(ACCEPTED);
    expect(await assignmentOutcome(tenant.operatorId, configure)).toBe(REJECTED_BY_CEILING);
    expect(await assignmentOutcome(tenant.operatorId, revealReset)).toBe(REJECTED_BY_CEILING);
    expect(await assignmentOutcome(tenant.adminId, revealReset)).toBe(ACCEPTED);
  });

  it('lets the application role call the ceiling function, which returns NULL for unknown names', async () => {
    const { rows } = await app.query<{ ceiling: number | null; unknown: number | null }>(
      "select permission_rank_ceiling('role.manage') as ceiling, permission_rank_ceiling('made.up') as unknown",
    );
    expect(rows[0]?.ceiling).toBe(1);
    expect(rows[0]?.unknown).toBeNull();
  });
});
