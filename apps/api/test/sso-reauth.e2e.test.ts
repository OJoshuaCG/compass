import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, freshTotp, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let organizationId: string;
let root: EnrolledSession;

interface SessionTimes {
  mfa_at: Date | null;
  reauth_at: Date | null;
}

const sessionTimes = async (): Promise<SessionTimes> =>
  (
    await env.db.admin.query<SessionTimes>(
      'select mfa_at, reauth_at from sessions where organization_id = $1 and revoked_at is null order by created_at desc limit 1',
      [organizationId],
    )
  ).rows[0] as SessionTimes;

const auditCount = async (action: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ total: string }>(
        'select count(*) as total from audit_events where organization_id = $1 and action = $2',
        [organizationId, action],
      )
    ).rows[0]?.total,
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'sr',
    rootEmail: 'root@sr.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;
  const client = new TestClient(env, '203.0.113.130');
  await client.post('/auth/login', { email: 'root@sr.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
});

afterAll(async () => {
  await env.close();
});

describe('POST /auth/sso-reauth', () => {
  it('renews mfa_at (auth_time) but not the 5-minute step-up window', async () => {
    const before = await sessionTimes();

    const response = await root.client.post('/auth/sso-reauth', {
      code: freshTotp(root.secret, env.clock),
    });
    const after = await sessionTimes();

    expect(response.status).toBe(204);
    expect(after.mfa_at?.getTime()).toBeGreaterThan(before.mfa_at?.getTime() ?? 0);
    expect(after.reauth_at).toEqual(before.reauth_at);
    expect(await auditCount('auth.sso_reauthenticated')).toBe(1);
  });

  it('rejects a wrong code, leaves mfa_at untouched and audits the failure', async () => {
    const before = await sessionTimes();

    const response = await root.client.post('/auth/sso-reauth', { code: '000000' });
    const after = await sessionTimes();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(after.mfa_at).toEqual(before.mfa_at);
  });

  it('does not let the regular step-up endpoint move mfa_at', async () => {
    const before = await sessionTimes();

    const response = await root.client.post('/auth/reauth', {
      code: freshTotp(root.secret, env.clock),
    });
    const after = await sessionTimes();

    expect(response.status).toBe(204);
    expect(after.mfa_at).toEqual(before.mfa_at);
    expect(after.reauth_at?.getTime()).toBeGreaterThan(before.reauth_at?.getTime() ?? 0);
  });
});
