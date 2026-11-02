import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, sqlState } from './helpers.js';
import type { TestDb } from './helpers.js';

const FIRST_ORGANIZATION_EXISTS = 'IAM01';
const INSUFFICIENT_PRIVILEGE = '42501';

// SENSIBLE (revisión humana): la migración 0028 abre una única vía de escritura sobre `organizations`.
describe('migration 0028: auth.create_first_organization', () => {
  const clusterAdminUrl = inject('adminUrl');
  let db: TestDb;
  let admin: Client;
  let app: Client;
  let worker: Client;

  beforeAll(async () => {
    db = await createMigratedDatabase(clusterAdminUrl);
    admin = await connect(db.adminUrl);
    app = await connect(db.appUrl);
    worker = await connect(db.workerUrl);
  });

  afterAll(async () => {
    await Promise.all([admin.end(), app.end(), worker.end()]);
  });

  const countOrganizations = async (): Promise<number> => {
    const { rows } = await admin.query<{ n: string }>(
      'select count(*)::text as n from organizations',
    );
    return Number(rows[0]?.n);
  };

  it('keeps direct inserts into organizations closed for iam_app', async () => {
    const state = await sqlState(
      app,
      "insert into organizations (name, slug) values ('Direct', 'direct')",
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await countOrganizations()).toBe(0);
  });

  it('is executable by iam_app only, not by other roles or PUBLIC', async () => {
    const { rows } = await admin.query<{
      public_can: boolean;
      app_can: boolean;
      worker_can: boolean;
      owner: string;
      secdef: boolean;
    }>(`
      select has_function_privilege('public', p.oid, 'EXECUTE') as public_can,
             has_function_privilege('iam_app', p.oid, 'EXECUTE') as app_can,
             has_function_privilege('iam_inbound_worker', p.oid, 'EXECUTE') as worker_can,
             r.rolname as owner, p.prosecdef as secdef
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
      join pg_roles r on r.oid = p.proowner
      where p.proname = 'create_first_organization'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      public_can: false,
      app_can: true,
      worker_can: false,
      owner: 'iam_auth_reader',
      secdef: true,
    });
    expect(
      await sqlState(worker, 'select auth.create_first_organization($1, $2, $3)', [
        randomUUID(),
        'Worker',
        'worker',
      ]),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('creates the first organization once and refuses every later call', async () => {
    const organizationId = randomUUID();
    expect(
      await sqlState(app, 'select auth.create_first_organization($1, $2, $3)', [
        organizationId,
        'Acme',
        'acme',
      ]),
    ).toBe('none');

    const { rows } = await admin.query<{ id: string; name: string; slug: string }>(
      'select id, name, slug from organizations',
    );
    expect(rows).toEqual([{ id: organizationId, name: 'Acme', slug: 'acme' }]);

    expect(
      await sqlState(app, 'select auth.create_first_organization($1, $2, $3)', [
        randomUUID(),
        'Second',
        'second',
      ]),
    ).toBe(FIRST_ORGANIZATION_EXISTS);
    expect(await countOrganizations()).toBe(1);
  });

  it('stays closed after an organization created by any other path', async () => {
    // La organización de la prueba anterior ya existe: nada de lo que se haga después la reabre.
    await admin.query("insert into organizations (name, slug) values ('Ops', 'ops')");
    expect(
      await sqlState(app, 'select auth.create_first_organization($1, $2, $3)', [
        randomUUID(),
        'Third',
        'third',
      ]),
    ).toBe(FIRST_ORGANIZATION_EXISTS);
  });
});

describe('migration 0028: concurrent calls', () => {
  const clusterAdminUrl = inject('adminUrl');

  it('lets exactly one of several simultaneous calls create the organization', async () => {
    const db = await createMigratedDatabase(clusterAdminUrl);
    const clients = await Promise.all(Array.from({ length: 5 }, () => connect(db.appUrl)));
    const admin = await connect(db.adminUrl);
    try {
      const outcomes = await Promise.all(
        clients.map((client, index) =>
          sqlState(client, 'select auth.create_first_organization($1, $2, $3)', [
            randomUUID(),
            `Race ${index}`,
            `race-${index}`,
          ]),
        ),
      );
      expect(outcomes.filter((state) => state === 'none')).toHaveLength(1);
      expect(outcomes.filter((state) => state === FIRST_ORGANIZATION_EXISTS)).toHaveLength(4);
      const { rows } = await admin.query<{ n: string }>(
        'select count(*)::text as n from organizations',
      );
      expect(rows[0]?.n).toBe('1');
    } finally {
      await Promise.all([...clients.map((client) => client.end()), admin.end()]);
    }
  });
});
