import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, signIn, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment } from './support/e2e.js';

const NEW_PASSWORD = 'Another-Strong-Passphrase-77';
const EMAIL = 'owner@pwd.test';

let env: E2eEnvironment;
let orgId: string;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'pwd',
    rootEmail: EMAIL,
    rootName: 'Grace Hopper',
    keepInitialPassword: true,
  });
  orgId = created.organizationId;
});

afterAll(async () => {
  await env.close();
});

const login = (client: TestClient, password: string) =>
  client.post<{ status: string } & ProblemDetails>('/auth/login', { email: EMAIL, password });

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string }>(
      'select outcome from audit_events where organization_id = $1 and action = $2',
      [orgId, action],
    )
  ).rows;

describe('the initial password of the Root is single use', () => {
  let owner: TestClient;
  let other: TestClient;
  let secret = '';
  beforeAll(() => {
    owner = new TestClient(env);
    other = new TestClient(env, '203.0.113.201');
  });

  it('signing in with it asks for a new one before anything else', async () => {
    const response = await login(owner, STRONG_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('password_change_required');
  });

  it('refuses to register or verify a second factor until the password is changed', async () => {
    for (const [path, code] of [
      ['/auth/mfa/totp/enroll', '123456'],
      ['/auth/mfa/verify', '123456'],
      ['/auth/mfa/recovery', 'ABCD-EFGH-JKLM'],
    ] as const) {
      const response = await owner.post<ProblemDetails>(path, { code });
      expect(response.status, path).toBe(403);
      expect(response.body.code, path).toBe('AUTH.PASSWORD_CHANGE_REQUIRED');
    }
    const confirm = await owner.post<ProblemDetails>('/auth/mfa/totp/confirm', { code: '123456' });
    expect(confirm.body.code).toBe('AUTH.PASSWORD_CHANGE_REQUIRED');
  });

  it('asks for the current password, so a stolen session cannot change it', async () => {
    const wrong = await owner.post<ProblemDetails>('/auth/password/change', {
      currentPassword: 'not-the-current-password',
      newPassword: NEW_PASSWORD,
    });

    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('AUTH.INVALID_CREDENTIALS');
    expect((await audit('auth.password_change_failed')).length).toBe(1);
  });

  it('applies the same strength policy as an invitation and refuses reusing the current one', async () => {
    const weak = await owner.post<ProblemDetails>('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'password1234',
    });
    const personal = await owner.post<ProblemDetails>('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'Hopper-and-Grace-2026!',
    });
    const same = await owner.post<ProblemDetails>('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: STRONG_PASSWORD,
    });

    expect(weak.body.code).toBe('PASSWORD.WEAK');
    expect(personal.body.code).toBe('PASSWORD.WEAK');
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('PASSWORD.REUSED');
  });

  it('changing it closes the other sessions, accepts the new one and rejects the old one', async () => {
    await login(other, STRONG_PASSWORD);
    expect((await other.get('/me')).status).toBe(403); // sesión a medias válida

    const changed = await owner.post('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(204);

    const stolen = await other.get<ProblemDetails>('/me');
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe('AUTHZ.SESSION');
    expect((await owner.get<ProblemDetails>('/me')).body.code).toBe('AUTH.ENROLLMENT_REQUIRED');
    expect((await audit('auth.password_changed')).length).toBe(1);

    const oldPassword = await login(new TestClient(env, '203.0.113.202'), STRONG_PASSWORD);
    expect(oldPassword.status).toBe(401);
  });

  it('then the second factor can be registered and the next sign-in asks for it', async () => {
    const enrolled = await enroll(env, owner);
    secret = enrolled.secret;
    expect(enrolled.recoveryCodes).toHaveLength(10);

    const next = await login(new TestClient(env, '203.0.113.203'), NEW_PASSWORD);
    expect(next.status).toBe(200);
    expect(next.body.status).toBe('mfa_required');
  });

  it('writes no password to the audit trail', async () => {
    const dump = await env.db.admin.query<{ blob: string }>(
      "select string_agg(metadata::text || coalesce(reason_code, ''), ' ') as blob from audit_events where organization_id = $1",
      [orgId],
    );
    const blob = dump.rows[0]?.blob ?? '';
    expect(blob).not.toContain(STRONG_PASSWORD);
    expect(blob).not.toContain(NEW_PASSWORD);
  });

  it('a password-only session cannot change a password that is already in force', async () => {
    const partial = new TestClient(env, '203.0.113.205');
    await login(partial, NEW_PASSWORD);

    const response = await partial.post<ProblemDetails>('/auth/password/change', {
      currentPassword: NEW_PASSWORD,
      newPassword: 'Yet-Another-Strong-Phrase-31',
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTH.MFA_REQUIRED');
    expect((await login(new TestClient(env, '203.0.113.206'), NEW_PASSWORD)).status).toBe(200);
  });

  it('repeated wrong current passwords hit the temporary lock', async () => {
    const fresh = await signIn(env, EMAIL, secret, NEW_PASSWORD, '203.0.113.204');
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      env.clock.advance(70_000);
      statuses.push(
        (
          await fresh.post('/auth/password/change', {
            currentPassword: 'definitely-wrong-123',
            newPassword: NEW_PASSWORD,
          })
        ).status,
      );
    }
    expect(statuses).toContain(429);
  });
});
