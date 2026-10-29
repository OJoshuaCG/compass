import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant } from './helpers.js';
import type { Tenant } from './helpers.js';

// ADR 0038: los trabajos de fondo listan organizaciones con una función `auth` y purgan bajo RLS.

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

const insertChallenge = (orgId: string, userId: string, tag: string, expiresIn: string) =>
  inOrg(app, orgId, () =>
    app.query(
      `insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at)
       values ($1, $2, uuid_generate_v7(), 'authentication', $3, now() + $4::interval)`,
      [orgId, userId, `purge-${tag}-0123456789`, expiresIn],
    ),
  );

const challengeCount = async (orgId: string, tag: string): Promise<number> => {
  const { rows } = await inOrg(app, orgId, () =>
    app.query<{ n: number }>(
      'select count(*)::int as n from webauthn_challenges where challenge = $1',
      [`purge-${tag}-0123456789`],
    ),
  );
  return rows[0]?.n ?? -1;
};

describe('auth.list_organization_ids (background jobs)', () => {
  it('lists every organization id, and only the id, without a tenant context', async () => {
    const { rows, fields } = await app.query<{ id: string }>(
      'select * from auth.list_organization_ids() as id',
    );
    expect(fields.map((field) => field.name)).toEqual(['id']);
    expect(rows.map((row) => row.id).sort()).toEqual([a.orgId, b.orgId].sort());
  });

  it('lets iam_auth_reader read the id column of organizations and no other', async () => {
    const { rows } = await admin.query<{ column_name: string; readable: boolean }>(
      `select a.attname as column_name,
              has_column_privilege('iam_auth_reader', 'public.organizations', a.attname, 'SELECT') as readable
         from pg_attribute a
        where a.attrelid = 'public.organizations'::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attnum`,
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((row) => row.readable).map((row) => row.column_name)).toEqual(['id']);
  });

  it('keeps the listing policy to iam_auth_reader: iam_app without a tenant still sees no organization', async () => {
    const { rows } = await app.query<{ n: number }>('select count(*)::int as n from organizations');
    expect(rows[0]?.n).toBe(0);
    const policy = await admin.query<{ roles: string[] }>(
      `select roles::text[] as roles from pg_policies where tablename = 'organizations' and policyname = 'organizations_job_listing'`,
    );
    expect(policy.rows[0]?.roles).toEqual(['iam_auth_reader']);
  });
});

describe('purging expired ephemeral rows under RLS', () => {
  it('iam_app deletes expired challenges only of the organization in context', async () => {
    await insertChallenge(a.orgId, a.rootId, 'a-old', '-2 hours');
    await insertChallenge(a.orgId, a.rootId, 'a-live', '5 minutes');
    await insertChallenge(b.orgId, b.rootId, 'b-old', '-2 hours');

    const { rowCount } = await inOrg(app, a.orgId, () =>
      app.query("delete from webauthn_challenges where expires_at < now() - interval '1 hour'"),
    );

    expect(rowCount).toBe(1);
    expect(await challengeCount(a.orgId, 'a-old')).toBe(0);
    expect(await challengeCount(a.orgId, 'a-live')).toBe(1);
    // La otra organización no se toca aunque su desafío también esté vencido.
    expect(await challengeCount(b.orgId, 'b-old')).toBe(1);
  });

  it('without a tenant context the delete matches nothing (fails closed)', async () => {
    const { rowCount } = await app.query('delete from webauthn_challenges');
    expect(rowCount).toBe(0);
    expect(await challengeCount(b.orgId, 'b-old')).toBe(1);
  });
});
