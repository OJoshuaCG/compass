import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let orgId: string;
let rootId: string;
let emergencyCodes: readonly string[];
let root: EnrolledSession;
let adminA: EnrolledSession;
let adminB: EnrolledSession;

const row = async () =>
  (await env.db.admin.query<{ status: string }>('select status from users where id = $1', [rootId]))
    .rows[0];
const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string }>(
      'select outcome from audit_events where organization_id = $1 and action = $2',
      [orgId, action],
    )
  ).rows;
const login = async (ip: string): Promise<TestClient> => {
  const client = new TestClient(env, ip);
  const response = await client.post('/auth/login', {
    email: 'root@em.test',
    password: STRONG_PASSWORD,
  });
  expect(response.status).toBe(200);
  return client;
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'em',
    rootEmail: 'root@em.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  rootId = created.rootUserId;
  emergencyCodes = created.emergencyCodes;
  root = await enroll(env, await login('203.0.113.90'));
  adminA = await inviteAndOnboard(env, root.client, { email: 'a@em.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@em.test', rank: 1 });
});

afterAll(async () => {
  await env.close();
});

describe('the emergency codes of the Root', () => {
  it('are eight, stored only as hashes, and survive registering a second factor', async () => {
    expect(emergencyCodes).toHaveLength(8);
    const rows = await env.db.admin.query<{ kind: string; used_at: Date | null }>(
      'select kind, used_at from user_recovery_codes where user_id = $1',
      [rootId],
    );
    expect(rows.rows.filter((r) => r.kind === 'emergency' && r.used_at === null)).toHaveLength(8);
    expect(rows.rows.filter((r) => r.kind === 'recovery' && r.used_at === null)).toHaveLength(10);
    const stored = await env.db.admin.query<{ blob: string }>(
      "select string_agg(encode(code_hash, 'hex'), ' ') as blob from user_recovery_codes where user_id = $1",
      [rootId],
    );
    expect(stored.rows[0]?.blob).not.toContain(emergencyCodes[0]?.replace(/-/g, '') ?? 'x');
  });

  it('an ordinary recovery code does NOT reset anything (regression)', async () => {
    const client = await login('203.0.113.91');
    const code = root.recoveryCodes[0] ?? '';
    expect((await client.post('/auth/mfa/recovery', { code })).status).toBe(204);
    expect((await client.get('/me')).status).toBe(200);
    expect(env.mailer.alerts).toHaveLength(0);
    expect((await row())?.status).toBe('active');
  });

  it('a wrong code is refused like any other, and uses nothing up', async () => {
    const client = await login('203.0.113.92');
    const wrong = await client.post<ProblemDetails>('/auth/mfa/recovery', {
      code: 'ZZZZ-ZZZZ-ZZZZ',
    });
    expect(wrong.status).toBe(401);
    expect(env.mailer.alerts).toHaveLength(0);
  });

  it('using one resets the second factor, closes other sessions, is a critical event and alerts the Administrators', async () => {
    const stolen = await login('203.0.113.93'); // otra sesión de la Raíz, a medias
    const client = await login('203.0.113.94');
    const oldSecret = root.secret;

    const used = await client.post('/auth/mfa/recovery', { code: emergencyCodes[0] });
    expect(used.status).toBe(204);

    // De vuelta al alta del 2FA: sin sesión completa, sin factor, el resto de sesiones cerradas.
    expect((await row())?.status).toBe('invited');
    expect((await client.get<ProblemDetails>('/me')).body.code).toBe('AUTH.ENROLLMENT_REQUIRED');
    expect((await stolen.get('/me')).status).toBe(401);
    expect((await root.client.get('/me')).status).toBe(401);
    expect((await audit('auth.emergency_code_used')).map((e) => e.outcome)).toEqual(['success']);
    expect(env.mailer.alerts.map((a) => a.to).sort()).toEqual(['a@em.test', 'b@em.test']);

    // El código no se reutiliza, y el secreto TOTP anterior ya no sirve.
    const again = await login('203.0.113.95');
    expect((await again.post('/auth/mfa/recovery', { code: emergencyCodes[0] })).status).toBe(401);
    const stale = await again.post<ProblemDetails>('/auth/mfa/verify', {
      code: freshTotp(oldSecret, env.clock),
    });
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(stale.status).not.toBe(204);

    // Registrar uno nuevo devuelve la cuenta a la normalidad con códigos de recuperación nuevos.
    const fresh = await enroll(env, client);
    expect(fresh.secret).not.toBe(oldSecret);
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect((await client.get('/me')).status).toBe(200);
    expect((await row())?.status).toBe('active');
    const left = await env.db.admin.query(
      "select 1 from user_recovery_codes where user_id = $1 and kind = 'emergency' and used_at is null",
      [rootId],
    );
    expect(left.rowCount).toBe(7);
  });

  it('works even if the alert mail cannot be sent', async () => {
    const client = await login('203.0.113.96');
    env.mailer.failNext = true;
    expect((await client.post('/auth/mfa/recovery', { code: emergencyCodes[1] })).status).toBe(204);
    expect((await row())?.status).toBe('invited');
    expect((await audit('auth.emergency_code_used')).length).toBe(2);
  });

  it('an Administrator cannot reset the Root: there is no such route and their actions are denied', async () => {
    const rootAgain = await login('203.0.113.97');
    expect(rootAgain).toBeDefined();
    for (const [path, body] of [
      [`/users/${rootId}/suspend`, {}],
      [`/users/${rootId}/deactivate`, {}],
      [`/users/${rootId}/rank`, { rank: 1 }],
    ] as const) {
      expect((await adminA.client.post(path, body)).status).toBe(403);
    }
    expect(
      (await adminB.client.post('/auth/mfa/recovery', { code: emergencyCodes[2] })).status,
    ).toBe(401);
  });
});
