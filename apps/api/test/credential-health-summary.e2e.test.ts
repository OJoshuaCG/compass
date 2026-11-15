import { credentialHealthSummarySchema } from '@iam/contracts';
import type { ProblemDetails, Role } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Salud de credenciales, T3c: paneles por organización y por grupo, de punta a punta por HTTP.
// Reglas: solo conteos; la organización exige rango Administrador o superior; un grupo exige poder
// administrarlo; toda negación se audita y un grupo inexistente se ve igual que uno ajeno.
const DENIAL_GROUPING_WINDOW_MS = 61_000;
const UNKNOWN_GROUP_ID = '00000000-0000-4000-8000-000000000001';

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let admin: EnrolledSession;
let operator: EnrolledSession;
let groupId: string;

const auditRows = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null }>(
      `select outcome, reason_code from audit_events
        where organization_id = $1 and action = $2 order by seq`,
      [orgId, action],
    )
  ).rows;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'health',
    rootEmail: 'root@health.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.120');
  await rootClient.post('/auth/login', { email: 'root@health.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';
  admin = await inviteAndOnboard(env, root.client, {
    email: 'admin@health.test',
    rank: 1,
    roleIds: [roleId('Administrator')],
  });
  operator = await inviteAndOnboard(env, root.client, {
    email: 'operator@health.test',
    rank: 3,
    roleIds: [roleId('Operator')],
  });

  const rootId = (
    await env.db.admin.query<{ id: string }>('select id from users where email = $1', [
      'root@health.test',
    ])
  ).rows[0]?.id;
  groupId =
    (
      await env.db.admin.query<{ id: string }>(
        'insert into groups (organization_id, name, created_by) values ($1, $2, $3) returning id',
        [orgId, 'Health Squad', rootId],
      )
    ).rows[0]?.id ?? '';
});

afterAll(async () => {
  await env.close();
});

describe('organization panel', () => {
  it('returns only counts, uncached, to Root and to an Administrator', async () => {
    for (const session of [root, admin]) {
      const response = await session.client.get<{ data: unknown }>(
        '/credential-health/organization',
      );

      expect(response.status).toBe(200);
      expect(credentialHealthSummarySchema.strict().safeParse(response.body.data).success).toBe(
        true,
      );
      expect(String(response.headers['cache-control'])).toContain('no-store');
    }
  });

  it('denies an Operator and audits the denial', async () => {
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    const before = (await auditRows('authz.denied')).length;

    const response = await operator.client.get<ProblemDetails>('/credential-health/organization');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.PERMISSION');
    const after = await auditRows('authz.denied');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)?.outcome).toBe('denied');
  });

  it('requires a session', async () => {
    const anonymous = new TestClient(env, '203.0.113.121');

    const response = await anonymous.get('/credential-health/organization');

    expect(response.status).toBe(401);
  });
});

describe('group panel', () => {
  it('returns only counts to someone who can manage the group', async () => {
    const response = await root.client.get<{ data: unknown }>(
      `/credential-health/groups/${groupId}`,
    );

    expect(response.status).toBe(200);
    expect(credentialHealthSummarySchema.strict().safeParse(response.body.data).success).toBe(true);
    expect(String(response.headers['cache-control'])).toContain('no-store');
  });

  it('shows an existing group the person cannot manage exactly like one that does not exist', async () => {
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    const foreign = await operator.client.get<ProblemDetails>(
      `/credential-health/groups/${groupId}`,
    );
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    const missing = await operator.client.get<ProblemDetails>(
      `/credential-health/groups/${UNKNOWN_GROUP_ID}`,
    );

    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(foreign.body.code).toBe(missing.body.code);
  });

  it('rejects an id that is not a UUID', async () => {
    const response = await root.client.get('/credential-health/groups/not-a-uuid');

    expect(response.status).toBe(422);
  });
});
