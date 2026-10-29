import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { SYSTEM_ROLES } from '../src/modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from '../src/modules/audit/index.js';
import {
  PgOrganizationLister,
  PgSystemRoleStore,
  SyncSystemRoles,
} from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const REVEAL = 'credential.reveal_password';

let db: TestDatabase;
let orgA: string;
let orgB: string;
let sync: SyncSystemRoles;

interface RoleRow {
  id: string;
  name: string;
  permissions: string[];
  version: number;
}

const template = (name: string): readonly string[] => {
  const found = SYSTEM_ROLES.find((role) => role.name === name);
  if (found === undefined) throw new Error(`no template ${name}`);
  return found.permissions;
};

/** Operator "antiguo": la plantilla actual más el permiso que B5 retiró. */
const legacyOperatorPermissions = (): string[] => [...template('Operator'), REVEAL];

async function seedRole(
  organizationId: string,
  name: string,
  permissions: readonly string[],
  isSystem: boolean,
  createdBy: string | null,
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into roles (organization_id, name, is_system, permissions, created_by)
     values ($1, $2, $3, $4::text[], $5) returning id`,
    [organizationId, name, isSystem, permissions, createdBy],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedUser(organizationId: string, email: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank) values ($1, $2, 'Seed', 0) returning id",
    [organizationId, email],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function roleOf(roleId: string): Promise<RoleRow> {
  const result = await db.admin.query<RoleRow>(
    'select id, name, permissions, version from roles where id = $1',
    [roleId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('role not found');
  return row;
}

async function syncAudits(
  organizationId: string,
): Promise<{ target_id: string; actor_id: string | null; metadata: Record<string, string> }[]> {
  const result = await db.admin.query<{
    target_id: string;
    actor_id: string | null;
    metadata: Record<string, string>;
  }>(
    "select target_id, actor_id, metadata from audit_events where organization_id = $1 and action = 'role.system_synced' order by seq",
    [organizationId],
  );
  return result.rows;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('sync-a');
  orgB = await db.seedOrganization('sync-b');
  const rootA = await seedUser(orgA, 'root@sync-a.test');

  ids['operatorA'] = await seedRole(orgA, 'Operator', legacyOperatorPermissions(), true, null);
  ids['rootA'] = await seedRole(orgA, 'Root', template('Root'), true, null);
  ids['adminA'] = await seedRole(orgA, 'Administrator', template('Administrator'), true, null);
  ids['leaderA'] = await seedRole(orgA, 'Leader', template('Leader'), true, null);
  ids['customA'] = await seedRole(orgA, 'Custom reveal', [REVEAL, 'account.view'], false, rootA);
  ids['operatorB'] = await seedRole(orgB, 'Operator', legacyOperatorPermissions(), true, null);

  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  const generator = new UuidV7Generator();
  sync = new SyncSystemRoles({
    organizations: new PgOrganizationLister(db.appPool),
    store: new PgSystemRoleStore(uow),
    audit: new RecordAuditEvent({
      repository: new PgAuditEventRepository(uow),
      context: requestContext,
      ids: generator,
    }),
    scope: new PgTenantScope(requestContext, uow),
    ids: generator,
    templates: SYSTEM_ROLES,
  });
});

afterAll(async () => {
  await db.close();
});

describe('SyncSystemRoles (integration)', () => {
  it('removes the stale permission from Operator in every organization, bumps the version and audits', async () => {
    const summary = await sync.execute();

    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.rolesUpdated).toBe(2);
    for (const key of ['operatorA', 'operatorB']) {
      const operator = await roleOf(ids[key] ?? '');
      expect([...operator.permissions].sort()).toEqual([...template('Operator')].sort());
      expect(operator.permissions).not.toContain(REVEAL);
      expect(operator.version).toBe(2);
    }
    const auditsA = await syncAudits(orgA);
    expect(auditsA).toHaveLength(1);
    expect(auditsA[0]).toMatchObject({
      target_id: ids['operatorA'],
      actor_id: null,
      metadata: { roleName: 'Operator', removed: REVEAL, added: '' },
    });
    // Cada organización ve solo su propio rastro.
    const auditsB = await syncAudits(orgB);
    expect(auditsB).toHaveLength(1);
    expect(auditsB[0]?.target_id).toBe(ids['operatorB']);
  });

  it('leaves custom roles and already-matching system roles untouched', async () => {
    const custom = await roleOf(ids['customA'] ?? '');
    expect(custom.permissions).toEqual([REVEAL, 'account.view']);
    expect(custom.version).toBe(1);
    for (const key of ['rootA', 'adminA', 'leaderA']) {
      expect((await roleOf(ids[key] ?? '')).version).toBe(1);
    }
  });

  it('is idempotent: a second run changes and audits nothing', async () => {
    const summary = await sync.execute();

    expect(summary.rolesUpdated).toBe(0);
    expect((await roleOf(ids['operatorA'] ?? '')).version).toBe(2);
    expect(await syncAudits(orgA)).toHaveLength(1);
    expect(await syncAudits(orgB)).toHaveLength(1);
  });
});
