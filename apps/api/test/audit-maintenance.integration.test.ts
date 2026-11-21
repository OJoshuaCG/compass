import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  EnsureAuditPartitions,
  PgAuditEventRepository,
  PgAuditPartitionAdmin,
  VerifyAuditChains,
} from '../src/modules/audit/index.js';
import { PgOrganizationLister } from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

// SENSIBLE (revisión humana): trabajos de mantenimiento de la auditoría particionada (ADR 0024) contra una base
// real: la creación de particiones corre con el rol de migraciones y la verificación de cadenas con `iam_app`.

let db: TestDatabase;
let migratorPool: Pool;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  migratorPool = new Pool({ connectionString: db.adminUrl, max: 1 });
});

afterAll(async () => {
  await migratorPool.end();
  await db.close();
});

describe('EnsureAuditPartitions against a real database', () => {
  it('is idempotent: the second run creates nothing and keeps the 24 month runway', async () => {
    const now = new Date();
    const first = await new EnsureAuditPartitions({
      admin: new PgAuditPartitionAdmin(migratorPool),
      clock: { now: () => now },
    }).execute();
    const second = await new EnsureAuditPartitions({
      admin: new PgAuditPartitionAdmin(migratorPool),
      clock: { now: () => now },
    }).execute();

    expect(first.failure).toBeNull();
    expect(second).toMatchObject({ createdMonths: [], failure: null, lowRunway: false });
    expect(second.runwayAfterMonths).toBeGreaterThanOrEqual(24);
  });

  it('creates the missing months when the clock moves forward', async () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);

    const summary = await new EnsureAuditPartitions({
      admin: new PgAuditPartitionAdmin(migratorPool),
      clock: { now: () => future },
    }).execute();

    expect(summary.failure).toBeNull();
    expect(summary.createdMonths).toHaveLength(12);
    expect(summary.runwayAfterMonths).toBe(24);
  });

  it('cannot run with the application role, which has no execute right on the function', async () => {
    const summary = await new EnsureAuditPartitions({
      admin: new PgAuditPartitionAdmin(db.appPool),
      clock: {
        now: () => {
          const far = new Date();
          far.setUTCFullYear(far.getUTCFullYear() + 5);
          return far;
        },
      },
    }).execute();

    expect(summary.createdMonths).toEqual([]);
    expect(summary.failure).toBe('error (42501)');
  });
});

describe('VerifyAuditChains against a real database', () => {
  it('reports valid chains for every organization without writing any audit row', async () => {
    const orgA = await db.seedOrganization('chain-a');
    const orgB = await db.seedOrganization('chain-b');
    for (const organizationId of [orgA, orgA, orgB]) {
      await db.admin.query(
        "insert into audit_events (organization_id, action, outcome) values ($1, 'test.chain', 'success')",
        [organizationId],
      );
    }
    const before = await db.admin.query<{ total: string }>(
      'select count(*) as total from audit_events',
    );
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);

    const summary = await new VerifyAuditChains({
      organizations: new PgOrganizationLister(db.appPool),
      repository: new PgAuditEventRepository(uow),
      scope: new PgTenantScope(requestContext, uow),
      ids: new UuidV7Generator(),
    }).execute();

    const after = await db.admin.query<{ total: string }>(
      'select count(*) as total from audit_events',
    );
    expect(summary.brokenChains).toEqual([]);
    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.valid).toBe(summary.organizations);
    expect(summary.organizations).toBeGreaterThanOrEqual(2);
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
  });
});
