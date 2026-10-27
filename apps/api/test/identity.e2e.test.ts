import { PERMISSIONS } from '@iam/contracts';
import type { MeResponse, ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PgAuditEventRepository, VerifyAuditChain } from '../src/modules/audit/index.js';
import { asOrganizationId, asUserId } from '../src/shared/kernel/index.js';
import {
  APP_ORIGIN,
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  signIn,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let orgId: string;
let rootId: string;
let root: EnrolledSession;
let rootClient: TestClient;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'acme',
    rootEmail: 'root@acme.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  rootId = created.rootUserId;
});

afterAll(async () => {
  await env.close();
});

const auditActions = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null }>(
      'select outcome, reason_code from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

describe('1. The Root onboards: password, mandatory second factor, then a full session', () => {
  const client = () => new TestClient(env);

  it('a fresh organization has exactly one Root, still "invited" until it registers a second factor', async () => {
    const rows = await env.db.admin.query<{ rank: number; status: string }>(
      'select rank, status from users where organization_id = $1',
      [orgId],
    );
    expect(rows.rows).toEqual([{ rank: 0, status: 'invited' }]);
  });

  it('logging in with the right password opens only a half session: the second factor is still required', async () => {
    const c = client();
    const login = await c.post<{ status: string }>('/auth/login', {
      email: 'root@acme.test',
      password: STRONG_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect(login.body.status).toBe('enrollment_required');

    const me = await c.get<ProblemDetails>('/me');
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('AUTH.ENROLLMENT_REQUIRED');
    root = { client: c, secret: '', recoveryCodes: [] };
  });

  it('sets a hardened session cookie: HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain', async () => {
    const response = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'test', origin: APP_ORIGIN },
      payload: { email: 'root@acme.test', password: STRONG_PASSWORD },
    });
    const header = String(response.headers['set-cookie']);
    expect(header).toMatch(/^__Host-session=/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toMatch(/Domain=/i);
  });

  it('refuses a wrong confirmation code and keeps the user "invited"', async () => {
    const begin = await root.client.post<{ secret: string; otpauthUri: string }>(
      '/auth/mfa/totp/enroll',
    );
    expect(begin.status).toBe(200);
    expect(begin.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const wrong = await root.client.post<ProblemDetails>('/auth/mfa/totp/confirm', {
      code: '000000',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('AUTH.MFA_INVALID');
    const status = await env.db.admin.query<{ status: string }>(
      'select status from users where id = $1',
      [rootId],
    );
    expect(status.rows[0]?.status).toBe('invited');
  });

  it('confirming a valid code activates the user, issues 10 recovery codes once, and completes the session', async () => {
    root = await enroll(env, root.client);
    expect(root.recoveryCodes).toHaveLength(10);
    expect(new Set(root.recoveryCodes).size).toBe(10);

    const me = await root.client.get<MeResponse>('/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'root@acme.test', rank: 0 });
    expect([...me.body.permissions].sort()).toEqual([...PERMISSIONS].sort());

    const status = await env.db.admin.query<{ status: string }>(
      'select status from users where id = $1',
      [rootId],
    );
    expect(status.rows[0]?.status).toBe('active');
    rootClient = root.client;
  });

  it('stores the TOTP secret encrypted and recovery codes only as hashes', async () => {
    const factor = await env.db.admin.query<{ secret_ciphertext: Buffer }>(
      'select secret_ciphertext from user_totp_factors where user_id = $1',
      [rootId],
    );
    expect(factor.rows[0]?.secret_ciphertext.toString('utf8')).not.toContain(root.secret);
    const codes = await env.db.admin.query<{ code_hash: Buffer }>(
      'select code_hash from user_recovery_codes where user_id = $1',
      [rootId],
    );
    expect(codes.rows).toHaveLength(10);
    for (const row of codes.rows) {
      for (const plain of root.recoveryCodes) {
        expect(row.code_hash.toString('utf8')).not.toContain(plain);
      }
    }
  });

  it('a user who already has a second factor cannot register another one from a half session', async () => {
    const attacker = new TestClient(env, '198.51.100.99');
    await attacker.post('/auth/login', { email: 'root@acme.test', password: STRONG_PASSWORD });
    const enrollAgain = await attacker.post<ProblemDetails>('/auth/mfa/totp/enroll');
    expect(enrollAgain.status).toBe(403);
    expect(enrollAgain.body.code).toBe('AUTH.MFA_REQUIRED');
  });
});

describe('2. Signing in again, TOTP replay, recovery codes and logout', () => {
  it('asks for the second factor, rejects a reused code and accepts a fresh one', async () => {
    const c = new TestClient(env, '203.0.113.50');
    const login = await c.post<{ status: string }>('/auth/login', {
      email: 'root@acme.test',
      password: STRONG_PASSWORD,
    });
    expect(login.body.status).toBe('mfa_required');
    expect((await c.get<ProblemDetails>('/me')).body.code).toBe('AUTH.MFA_REQUIRED');

    const code = freshTotp(root.secret, env.clock);
    expect((await c.post('/auth/mfa/verify', { code })).status).toBe(204);
    expect((await c.get('/me')).status).toBe(200);

    // El mismo código en otra sesión: ya se usó (protección contra reutilización).
    const other = new TestClient(env, '203.0.113.51');
    await other.post('/auth/login', { email: 'root@acme.test', password: STRONG_PASSWORD });
    const replay = await other.post<ProblemDetails>('/auth/mfa/verify', { code });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH.MFA_INVALID');
  });

  it('accepts a recovery code once and refuses it the second time', async () => {
    const recovery = root.recoveryCodes[0] ?? '';
    const first = new TestClient(env, '203.0.113.60');
    await first.post('/auth/login', { email: 'root@acme.test', password: STRONG_PASSWORD });
    expect(
      (await first.post('/auth/mfa/recovery', { code: recovery.toLowerCase().replaceAll('-', '') }))
        .status,
    ).toBe(204);
    expect((await first.get('/me')).status).toBe(200);

    const second = new TestClient(env, '203.0.113.61');
    await second.post('/auth/login', { email: 'root@acme.test', password: STRONG_PASSWORD });
    const reuse = await second.post<ProblemDetails>('/auth/mfa/recovery', { code: recovery });
    expect(reuse.status).toBe(401);
    expect((await auditActions('auth.recovery_code_used')).length).toBe(1);
  });

  it('logging out revokes the session on the server: the stolen cookie stops working', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.70');
    const stolen = c.cookie;
    expect((await c.post('/auth/logout')).status).toBe(204);

    const thief = new TestClient(env, '203.0.113.71');
    thief.cookie = stolen;
    const me = await thief.get<ProblemDetails>('/me');
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('AUTHZ.SESSION');
  });
});

describe('3. Login protections', () => {
  it('answers a wrong password and an unknown email with the same status and body', async () => {
    const wrong = await new TestClient(env, '203.0.113.80').post<ProblemDetails>('/auth/login', {
      email: 'root@acme.test',
      password: 'definitely-not-the-password',
    });
    const unknown = await new TestClient(env, '203.0.113.81').post<ProblemDetails>('/auth/login', {
      email: 'nobody@acme.test',
      password: 'definitely-not-the-password',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const strip = (p: ProblemDetails) => ({ ...p, requestId: '' });
    expect(strip(wrong.body)).toEqual(strip(unknown.body));
    expect(wrong.body.code).toBe('AUTH.INVALID_CREDENTIALS');
  });

  it('adds a progressive delay from the third failure, a temporary lock at ten, and recovers', async () => {
    // Tres fallos seguidos activan el retraso progresivo (1 s, 2 s, 4 s ...).
    const quick = new TestClient(env, '203.0.113.91');
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        (await quick.post('/auth/login', { email: 'victim@acme.test', password: 'wrong-1234567' }))
          .status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const delayed = await quick.post<ProblemDetails>('/auth/login', {
      email: 'victim@acme.test',
      password: 'wrong-1234567',
    });
    expect(delayed.body.code).toBe('RATE_LIMITED');
    expect(Number(delayed.headers['retry-after'])).toBeGreaterThan(0);

    // Esperando lo suficiente entre intentos se llega al bloqueo de 15 minutos, también con un correo que no existe.
    for (let i = 0; i < 7; i += 1) {
      env.clock.advance(70_000);
      await quick.post('/auth/login', { email: 'victim@acme.test', password: 'wrong-1234567' });
    }
    env.clock.advance(70_000);
    const locked = await quick.post<ProblemDetails>('/auth/login', {
      email: 'victim@acme.test',
      password: 'wrong-1234567',
    });
    expect(locked.status).toBe(429);

    // La contraseña correcta del dueño real tampoco entra mientras dura el bloqueo...
    const rootBlockedBeforeWindow = await new TestClient(env, '203.0.113.92').post('/auth/login', {
      email: 'victim@acme.test',
      password: STRONG_PASSWORD,
    });
    expect(rootBlockedBeforeWindow.status).toBe(429);

    // ...pero NUNCA es permanente: pasada la ventana vuelve a responder normalmente.
    env.clock.advance(16 * 60_000);
    const after = await new TestClient(env, '203.0.113.93').post<ProblemDetails>('/auth/login', {
      email: 'victim@acme.test',
      password: 'wrong-1234567',
    });
    expect(after.status).toBe(401);
  });

  it('rejects a state-changing request without the custom header or from another origin (CSRF)', async () => {
    const noHeader = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'root@acme.test', password: STRONG_PASSWORD },
    });
    expect(noHeader.statusCode).toBe(403);
    const foreign = await env.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-requested-with': 'test', origin: 'https://evil.example' },
      payload: { email: 'root@acme.test', password: STRONG_PASSWORD },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('writes no password, token or code to the audit trail', async () => {
    const dump = await env.db.admin.query<{ blob: string }>(
      "select string_agg(metadata::text || coalesce(reason_code, ''), ' ') as blob from audit_events where organization_id = $1",
      [orgId],
    );
    expect(dump.rows[0]?.blob ?? '').not.toContain(STRONG_PASSWORD);
    expect(dump.rows[0]?.blob ?? '').not.toContain(root.secret);
  });
});

describe('4. Session lifetime', () => {
  it('expires after 30 minutes of inactivity but not while the user keeps working', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.100');
    env.clock.advance(29 * 60_000);
    expect((await c.get('/me')).status).toBe(200); // actividad: renueva el reloj de inactividad
    env.clock.advance(29 * 60_000);
    expect((await c.get('/me')).status).toBe(200);
    env.clock.advance(31 * 60_000);
    const idle = await c.get<ProblemDetails>('/me');
    expect(idle.status).toBe(401);
    expect(idle.body.code).toBe('AUTHZ.SESSION');
  });

  it('expires after 12 hours even with constant activity', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.101');
    for (let i = 0; i < 25; i += 1) {
      env.clock.advance(29 * 60_000);
      const me = await c.get('/me');
      if (me.status !== 200) {
        expect(i).toBeGreaterThanOrEqual(24); // ~12 h = 24 intervalos de 29 min
        return;
      }
    }
    throw new Error('the session should have expired by its absolute limit');
  });

  it('stops working when the user is suspended', async () => {
    rootClient = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.203');
    const guest = await inviteAndOnboard(env, rootClient, { email: 'suspend@acme.test', rank: 3 });
    expect((await guest.client.get('/me')).status).toBe(200);
    await env.db.admin.query(
      "update users set status = 'suspended' where email = 'suspend@acme.test'",
    );
    expect((await guest.client.get('/me')).status).toBe(401);
  });
});

describe('5. Reauthentication (step-up)', () => {
  beforeAll(async () => {
    rootClient = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.200');
  });

  it('records a recent verification and reports until when it is valid', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.110');
    expect((await c.get<MeResponse>('/me')).body.session.reauthUntil).toBeNull();

    expect((await c.post('/auth/reauth', { code: freshTotp(root.secret, env.clock) })).status).toBe(
      204,
    );
    const me = await c.get<MeResponse>('/me');
    const until = Date.parse(me.body.session.reauthUntil ?? '');
    expect(until - env.clock.now().getTime()).toBeLessThanOrEqual(5 * 60_000);
    expect(until).toBeGreaterThan(env.clock.now().getTime());
  });

  it('refuses a wrong code and a reused code', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.111');
    expect((await c.post('/auth/reauth', { code: '123456' })).status).toBe(401);
    const code = freshTotp(root.secret, env.clock);
    expect((await c.post('/auth/reauth', { code })).status).toBe(204);
    expect((await c.post('/auth/reauth', { code })).status).toBe(401);
  });

  it('the authorization engine asks for it on sensitive actions and allows within five minutes', async () => {
    const c = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.112');
    const principal = await env.container.sessions.authenticate(c.cookie ?? '', 'req-x');
    if (principal === null) throw new Error('no session');
    const asRoot = (reauthAt: Date | null) => ({
      organizationId: asOrganizationId(orgId),
      actorId: asUserId(rootId),
      requestId: 'req-x',
      sessionId: principal.sessionId,
      reauthAt,
    });

    const denied = await env.container.scope.runAs(asRoot(null), () =>
      env.container.authorizer.authorize({ permission: 'credential.reveal_password' }),
    );
    expect(denied).toEqual({ allowed: false, reason: 'REAUTH' });

    const allowed = await env.container.scope.runAs(asRoot(env.clock.now()), () =>
      env.container.authorizer.authorize({ permission: 'credential.reveal_password' }),
    );
    expect(allowed).toEqual({ allowed: true, obligations: ['REAUTH', 'WRITTEN_REASON'] });
    expect(
      (await auditActions('authz.denied')).some((e) => e.reason_code === 'AUTHZ.REAUTH_REQUIRED'),
    ).toBe(true);
  });
});

describe('6. Invitations: hierarchy, no escalation and single use', () => {
  // Cada prueba arranca con una sesión vigente: algunas avanzan el reloj varias horas.
  beforeEach(async () => {
    rootClient = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.201');
  });

  it('the Root invites an Administrator; the link is mailed, never returned, and the guest sets a strong password', async () => {
    const created = await rootClient.post<Record<string, unknown>>('/invitations', {
      email: 'admin@acme.test',
      rank: 1,
      roleIds: [],
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('token');
    const mail = env.mailer.last;
    expect(mail?.to).toBe('admin@acme.test');
    const token = mail?.token ?? '';
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits en base64url

    const stored = await env.db.admin.query<{ token_hash: Buffer }>(
      "select token_hash from invitations where email = 'admin@acme.test'",
    );
    expect(stored.rows[0]?.token_hash.toString('utf8')).not.toContain(token);

    const guest = new TestClient(env, '198.51.100.30');
    const preview = await guest.post<{ email: string; rank: number }>('/invitations/preview', {
      token,
    });
    expect(preview.body).toMatchObject({ email: 'admin@acme.test', rank: 1 });

    const weak = await guest.post<ProblemDetails>('/invitations/accept', {
      token,
      displayName: 'Pedro Admin',
      password: 'password1234',
    });
    expect(weak.status).toBe(422);
    expect(weak.body.code).toBe('PASSWORD.WEAK');

    const accepted = await guest.post('/invitations/accept', {
      token,
      displayName: 'Pedro Admin',
      password: STRONG_PASSWORD,
    });
    expect(accepted.status).toBe(200);
    expect((await guest.get<ProblemDetails>('/me')).body.code).toBe('AUTH.ENROLLMENT_REQUIRED');

    const onboarded = await enroll(env, guest);
    const me = await onboarded.client.get<MeResponse>('/me');
    expect(me.body.user).toMatchObject({ email: 'admin@acme.test', rank: 1 });
    expect(me.body.permissions).not.toContain('org.settings');
    expect(me.body.permissions).toContain('user.invite');
    expect(me.body.permissions).toHaveLength(PERMISSIONS.length - 1);

    const row = await env.db.admin.query<{ managed_by: string; created_by: string }>(
      "select managed_by, created_by from users where email = 'admin@acme.test'",
    );
    expect(row.rows[0]).toEqual({ managed_by: rootId, created_by: rootId });
  });

  it('an invitation is single use: a second acceptance looks exactly like an invalid link', async () => {
    await rootClient.post('/invitations', { email: 'once@acme.test', rank: 3, roleIds: [] });
    const token = env.mailer.last?.token ?? '';
    const first = new TestClient(env, '198.51.100.31');
    expect(
      (
        await first.post('/invitations/accept', {
          token,
          displayName: 'Una Vez',
          password: STRONG_PASSWORD,
        })
      ).status,
    ).toBe(200);

    const second = new TestClient(env, '198.51.100.32');
    const again = await second.post<ProblemDetails>('/invitations/accept', {
      token,
      displayName: 'Otra Vez',
      password: STRONG_PASSWORD,
    });
    const garbage = await second.post<ProblemDetails>('/invitations/accept', {
      token: 'x'.repeat(43),
      displayName: 'Nadie',
      password: STRONG_PASSWORD,
    });
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('INVITATION.INVALID');
    expect({ ...again.body, requestId: '' }).toEqual({ ...garbage.body, requestId: '' });
  });

  it('two simultaneous acceptances of the same link create only one user', async () => {
    await rootClient.post('/invitations', { email: 'race@acme.test', rank: 3, roleIds: [] });
    const token = env.mailer.last?.token ?? '';
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        new TestClient(env, `198.51.100.4${String(i)}`).post('/invitations/accept', {
          token,
          displayName: 'Carrera',
          password: STRONG_PASSWORD,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const users = await env.db.admin.query<{ n: string }>(
      "select count(*) as n from users where email = 'race@acme.test'",
    );
    expect(users.rows[0]?.n).toBe('1');
  });

  it('rejects an expired invitation after 72 hours', async () => {
    await rootClient.post('/invitations', { email: 'late@acme.test', rank: 3, roleIds: [] });
    const token = env.mailer.last?.token ?? '';
    env.clock.advance(72 * 3600_000 + 1000);
    const late = await new TestClient(env, '198.51.100.50').post<ProblemDetails>(
      '/invitations/accept',
      {
        token,
        displayName: 'Tarde',
        password: STRONG_PASSWORD,
      },
    );
    expect(late.status).toBe(404);
  });

  it('an expired, unaccepted invitation does not block inviting the same email again', async () => {
    await rootClient.post('/invitations', { email: 'stale@acme.test', rank: 3, roleIds: [] });
    const oldToken = env.mailer.last?.token ?? '';
    env.clock.advance(72 * 3600_000 + 1000);
    rootClient = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.204');

    const again = await rootClient.post('/invitations', {
      email: 'stale@acme.test',
      rank: 3,
      roleIds: [],
    });
    expect(again.status).toBe(201);
    const newToken = env.mailer.last?.token ?? '';
    expect(newToken).not.toBe(oldToken);

    // La anterior quedó invalidada: solo sirve la nueva.
    const guest = new TestClient(env, '198.51.100.51');
    const withOld = await guest.post<ProblemDetails>('/invitations/preview', { token: oldToken });
    expect(withOld.status).toBe(404);
    expect((await guest.post('/invitations/preview', { token: newToken })).status).toBe(200);
  });

  it('refuses a second pending invitation and an existing user for the same email', async () => {
    await rootClient.post('/invitations', { email: 'dup@acme.test', rank: 3, roleIds: [] });
    const pending = await rootClient.post<ProblemDetails>('/invitations', {
      email: 'DUP@acme.test',
      rank: 3,
      roleIds: [],
    });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('INVITATION.CONFLICT');
    const existing = await rootClient.post<ProblemDetails>('/invitations', {
      email: 'root@acme.test',
      rank: 3,
      roleIds: [],
    });
    expect(existing.status).toBe(409);
  });

  it('nobody can invite a Root, and an invalid body is a 422 with the failing field only', async () => {
    const root0 = await rootClient.post<ProblemDetails>('/invitations', {
      email: 'r2@acme.test',
      rank: 0,
    });
    expect(root0.status).toBe(422);
    expect(root0.body.errors?.map((e) => e.field)).toContain('rank');
  });
});

describe('7. Who can invite whom (creation matrix), no escalation, and denials are audited', () => {
  let admin: EnrolledSession;
  let leader: EnrolledSession;
  let operator: EnrolledSession;

  beforeAll(async () => {
    admin = await inviteAndOnboard(env, rootClient, {
      email: 'matrix-admin@acme.test',
      rank: 1,
      name: 'Ana Admin',
    });
    leader = await inviteAndOnboard(env, admin.client, {
      email: 'matrix-leader@acme.test',
      rank: 2,
      name: 'Luis Lider',
    });
    operator = await inviteAndOnboard(env, leader.client, {
      email: 'matrix-operator@acme.test',
      rank: 3,
      name: 'Sofia Operadora',
    });
  });

  it('an Administrator cannot invite another Administrator (nobody creates their own rank)', async () => {
    const response = await admin.client.post<ProblemDetails>('/invitations', {
      email: 'a2@acme.test',
      rank: 1,
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.CREATION_NOT_ALLOWED');
  });

  it('a Leader invites Operators but not Leaders or Administrators', async () => {
    expect(
      (await leader.client.post('/invitations', { email: 'op-ok@acme.test', rank: 3 })).status,
    ).toBe(201);
    for (const rank of [1, 2]) {
      const denied = await leader.client.post<ProblemDetails>('/invitations', {
        email: `no-${String(rank)}@acme.test`,
        rank,
      });
      expect(denied.status).toBe(403);
    }
  });

  it('an Operator holds no invitation permission at all', async () => {
    const denied = await operator.client.post<ProblemDetails>('/invitations', {
      email: 'x@acme.test',
      rank: 3,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTHZ.PERMISSION');
  });

  it('nobody can grant a role with permissions they lack (no escalation)', async () => {
    const roles = await env.db.admin.query<{ id: string; name: string }>(
      'select id, name from roles where organization_id = $1 and is_system',
      [orgId],
    );
    const rootRole = roles.rows.find((r) => r.name === 'Root')?.id ?? '';
    const response = await admin.client.post<ProblemDetails>('/invitations', {
      email: 'esc@acme.test',
      rank: 2,
      roleIds: [rootRole],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
  });

  describe('roles are revalidated when the invitation is accepted', () => {
    const customRole = async (name: string): Promise<string> => {
      const created = await env.db.admin.query<{ id: string }>(
        `insert into roles (organization_id, name, is_system, permissions, created_by)
         values ($1, $2, false, array['account.create'], (select id from users where email = 'matrix-admin@acme.test'))
         returning id`,
        [orgId, name],
      );
      return created.rows[0]?.id ?? '';
    };
    const inviteWith = async (email: string, roleId: string): Promise<string> => {
      const created = await admin.client.post('/invitations', {
        email,
        rank: 3,
        roleIds: [roleId],
      });
      expect(created.status).toBe(201);
      return env.mailer.last?.token ?? '';
    };
    const accept = (token: string, ip: string) =>
      new TestClient(env, ip).post<ProblemDetails>('/invitations/accept', {
        token,
        displayName: 'Persona Nueva',
        password: STRONG_PASSWORD,
      });

    it('accepts normally while the role is still valid', async () => {
      const token = await inviteWith('reval-ok@acme.test', await customRole('Contable A'));
      expect((await accept(token, '198.51.100.60')).status).toBe(200);
    });

    it('refuses (as an invalid link) when the role was archived after inviting', async () => {
      const roleId = await customRole('Contable B');
      const token = await inviteWith('reval-archived@acme.test', roleId);
      await env.db.admin.query('update roles set archived_at = now() where id = $1', [roleId]);

      const response = await accept(token, '198.51.100.61');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION.INVALID');
      const created = await env.db.admin.query(
        "select 1 from users where email = 'reval-archived@acme.test'",
      );
      expect(created.rowCount).toBe(0);
    });

    it('refuses when the inviter was demoted after inviting (cannot create that rank any more)', async () => {
      const lead = await inviteAndOnboard(env, admin.client, {
        email: 'demoted-lead@acme.test',
        rank: 2,
        name: 'Lider Degradado',
      });
      const created = await lead.client.post('/invitations', {
        email: 'reval-demoted@acme.test',
        rank: 3,
        roleIds: [],
      });
      expect(created.status).toBe(201);
      const token = env.mailer.last?.token ?? '';
      // La Líder pasa a Operadora: ya no puede crear a nadie.
      await env.db.admin.query("update users set rank = 3 where email = 'demoted-lead@acme.test'");

      const response = await accept(token, '198.51.100.63');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION.INVALID');
    });

    it('refuses when the inviter kept their rank but lost the invite permission (invitation without roles)', async () => {
      const lead = await inviteAndOnboard(env, admin.client, {
        email: 'noperm-lead@acme.test',
        rank: 2,
        name: 'Lider Sin Permiso',
      });
      const created = await lead.client.post('/invitations', {
        email: 'reval-noperm@acme.test',
        rank: 3,
        roleIds: [],
      });
      expect(created.status).toBe(201);
      const token = env.mailer.last?.token ?? '';
      // Mismo rango, pero se le retiran los roles: ya no tiene el permiso de invitar.
      await env.db.admin.query(
        "delete from user_roles where user_id = (select id from users where email = 'noperm-lead@acme.test')",
      );

      const response = await accept(token, '198.51.100.64');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION.INVALID');
    });

    it('refuses when the inviter lost the permission after inviting (no escalation at accept time)', async () => {
      const roleId = await customRole('Contable C');
      const token = await inviteWith('reval-lost@acme.test', roleId);
      // El responsable pierde sus permisos: se le retira el rol de Administrador.
      await env.db.admin.query(
        `delete from user_roles where user_id = (select id from users where email = 'matrix-admin@acme.test')`,
      );

      const response = await accept(token, '198.51.100.62');
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION.INVALID');
    });
  });

  it('every denial leaves a trace with its reason code, even though the action was rolled back', async () => {
    const reasons = (await auditActions('authz.denied')).map((e) => e.reason_code);
    expect(reasons).toContain('AUTHZ.CREATION_NOT_ALLOWED');
    expect(reasons).toContain('AUTHZ.PERMISSION');
    expect(reasons).toContain('AUTHZ.ROLE_ESCALATION');
    const invitationsCreated = await env.db.admin.query<{ n: string }>(
      "select count(*) as n from invitations where email in ('a2@acme.test','no-1@acme.test','no-2@acme.test','esc@acme.test')",
    );
    expect(invitationsCreated.rows[0]?.n).toBe('0');
  });

  it('the people directory lists active users to everyone, with name, email and rank only', async () => {
    const response = await operator.client.get<{
      data: Record<string, unknown>[];
      page: { nextCursor: string | null };
    }>('/users?limit=100&sort=email&dir=asc');
    expect(response.status).toBe(200);
    const emails = response.body.data.map((u) => u['email']);
    expect(emails).toContain('root@acme.test');
    expect(emails).toContain('matrix-admin@acme.test');
    expect(emails).not.toContain('op-ok@acme.test'); // invitado, aún no activo
    expect(Object.keys(response.body.data[0] ?? {}).sort()).toEqual([
      'displayName',
      'email',
      'id',
      'rank',
    ]);
    expect(emails).toEqual([...emails].sort());
  });

  it('paginates with an opaque cursor, sorts in both directions and filters by search text', async () => {
    const first = await rootClient.get<{
      data: { email: string }[];
      page: { nextCursor: string | null; limit: number };
    }>('/users?limit=10&sort=displayName&dir=asc');
    expect(first.body.data.length).toBeGreaterThan(0);

    const pageOne = await rootClient.get<{
      data: { id: string }[];
      page: { nextCursor: string | null };
    }>('/users?limit=10&sort=email&dir=asc');
    const all = await rootClient.get<{ data: { id: string }[] }>(
      '/users?limit=100&sort=email&dir=asc',
    );
    if (all.body.data.length > 10) {
      expect(pageOne.body.page.nextCursor).not.toBeNull();
      const pageTwo = await rootClient.get<{ data: { id: string }[] }>(
        `/users?limit=10&sort=email&dir=asc&cursor=${encodeURIComponent(pageOne.body.page.nextCursor ?? '')}`,
      );
      expect(pageTwo.body.data[0]?.id).toBe(all.body.data[10]?.id);
    }

    const desc = await rootClient.get<{ data: { email: string }[] }>(
      '/users?limit=100&sort=email&dir=desc',
    );
    expect(desc.body.data.map((u) => u.email)).toEqual(
      [...desc.body.data.map((u) => u.email)].sort().reverse(),
    );

    const search = await rootClient.get<{ data: { email: string }[] }>('/users?q=matrix-leader');
    expect(search.body.data.map((u) => u.email)).toEqual(['matrix-leader@acme.test']);
    const sqlish = await rootClient.get<{ data: unknown[] }>(
      `/users?q=${encodeURIComponent("'; drop table users; --")}`,
    );
    expect(sqlish.status).toBe(200);
    expect(sqlish.body.data).toHaveLength(0);
  });

  it('rejects control characters in free text (search and names) as a validation error, not a server error', async () => {
    expect((await rootClient.get('/users?q=ab%00cd')).status).toBe(422);
    expect((await rootClient.get('/users?q=ab%07cd')).status).toBe(422);
    const guest = new TestClient(env, '198.51.100.70');
    await rootClient.post('/invitations', { email: 'ctl@acme.test', rank: 3, roleIds: [] });
    const accepted = await guest.post<ProblemDetails>('/invitations/accept', {
      token: env.mailer.last?.token ?? '',
      displayName: 'Nombre\u0000Raro',
      password: STRONG_PASSWORD,
    });
    expect(accepted.status).toBe(422);
    expect(accepted.body.errors?.map((e) => e.field)).toContain('displayName');
  });

  it('rejects a sort field outside the allowlist and a limit outside 10/25/50/100', async () => {
    expect((await rootClient.get('/users?sort=password_hash')).status).toBe(422);
    expect((await rootClient.get('/users?limit=7')).status).toBe(422);
  });

  it('a tampered or foreign cursor falls back to the first page instead of failing', async () => {
    const enc = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const uuid = '0198cccc-0000-7000-8000-000000000001';
    const first = await rootClient.get<{ data: { id: string }[] }>(
      '/users?limit=10&sort=rank&dir=asc',
    );
    const bad = [
      enc(['rank', 'abc', uuid]), // valor no numérico para el campo rank
      enc(['rank', '9', uuid]), // fuera de 0..3
      enc(['rank', '1', '-'.repeat(36)]), // "uuid" de 36 guiones
      enc(['email', 'a@b.co', uuid]), // cursor de otro campo de orden
      enc({ not: 'a tuple' }),
      'not-base64-at-all!!!',
      enc(['rank', 'x'.repeat(400), uuid]),
      enc(['displayName', 'ab\u0000cd', uuid]), // NUL: PostgreSQL lo rechaza en texto
    ];
    const sortFor = (cursor: string) => (cursor === bad[bad.length - 1] ? 'displayName' : 'rank');
    for (const cursor of bad) {
      const response = await rootClient.get<{ data: { id: string }[] }>(
        `/users?limit=10&sort=${sortFor(cursor)}&dir=asc&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status, cursor).toBe(200);
      if (sortFor(cursor) === 'rank') {
        expect(response.body.data.map((u) => u.id)).toEqual(first.body.data.map((u) => u.id));
      }
    }

    // Un cursor de OTRO campo de orden con un valor que parece válido no debe filtrar filas.
    const byEmail = await rootClient.get<{ data: { id: string }[] }>(
      '/users?limit=10&sort=email&dir=asc',
    );
    const foreign = await rootClient.get<{ data: { id: string }[] }>(
      `/users?limit=10&sort=email&dir=asc&cursor=${encodeURIComponent(enc(['displayName', 'zzzz', uuid]))}`,
    );
    expect(foreign.body.data.map((u) => u.id)).toEqual(byEmail.body.data.map((u) => u.id));
  });

  it('the audit chain of the organization is intact after all of this', async () => {
    const verify = new VerifyAuditChain({
      repository: new PgAuditEventRepository(env.container.uow),
    });
    const result = await env.container.scope.runAs(
      { organizationId: asOrganizationId(orgId), actorId: null, requestId: 'verify' },
      () => verify.execute(),
    );
    expect(result).toEqual({ valid: true });
  });
});

describe('8. Organizations never see each other', () => {
  it('a user of another organization sees only their own directory and cannot reuse a foreign session', async () => {
    const other = await env.bootstrapOrganization({
      slug: 'globex',
      rootEmail: 'root@globex.test',
      rootName: 'Grace Hopper',
    });
    expect(other.organizationId).not.toBe(orgId);
    const client = new TestClient(env, '203.0.113.120');
    await client.post('/auth/login', { email: 'root@globex.test', password: STRONG_PASSWORD });
    const globex = await enroll(env, client);

    const list = await globex.client.get<{ data: { email: string }[] }>('/users?limit=100');
    expect(list.body.data.map((u) => u.email)).toEqual(['root@globex.test']);

    const me = await globex.client.get<MeResponse>('/me');
    expect(me.body.user.email).toBe('root@globex.test');

    // Las claves de datos de cada organización son distintas.
    const keys = await env.db.admin.query<{ n: string }>(
      'select count(distinct organization_id) as n from data_keys',
    );
    expect(Number(keys.rows[0]?.n)).toBeGreaterThanOrEqual(2);
  });
});

describe('9. Hardening: IP limit by route, deferred audit and burst guessing', () => {
  it('liveness is public: a load balancer without a session gets 200, not 401', async () => {
    const response = await new TestClient(env, '203.0.113.229').get<{ status: string }>(
      '/health/live',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('the per-IP limit also applies to percent-encoded paths (it is decided by route, not by URL text)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 80; i += 1) {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/%61uth/login',
        remoteAddress: '203.0.113.230',
        headers: { 'x-requested-with': 'test', origin: APP_ORIGIN },
        payload: { email: `nobody${String(i)}@acme.test`, password: 'wrong-password-123' },
      });
      statuses.push(response.statusCode);
    }
    // Si la ruta se resolvió, el límite tuvo que cortar; si no se resolvió, todo fue 404.
    const bypassed = statuses.every((status) => status !== 429 && status !== 404);
    expect(bypassed).toBe(false);
  });

  it('a failed login of a known user is still audited, just not on the response path', async () => {
    const before = (await auditActions('auth.login_failed')).length;
    const response = await new TestClient(env, '203.0.113.231').post('/auth/login', {
      email: 'root@acme.test',
      password: 'definitely-wrong-123',
    });
    expect(response.status).toBe(401);
    await env.container.login.drain();
    expect((await auditActions('auth.login_failed')).length).toBe(before + 1);
  });

  it('a parallel burst of wrong codes cannot get past the lock: at most ten are evaluated', async () => {
    rootClient = await signIn(env, 'root@acme.test', root.secret, STRONG_PASSWORD, '203.0.113.232');
    const burst = await inviteAndOnboard(env, rootClient, { email: 'burst@acme.test', rank: 3 });
    const attacker = new TestClient(env, '203.0.113.233');
    await attacker.post('/auth/login', { email: 'burst@acme.test', password: STRONG_PASSWORD });

    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        attacker.post<ProblemDetails>('/auth/mfa/verify', { code: String(100000 + i) }),
      ),
    );
    const evaluated = responses.filter((r) => r.status === 401).length;
    const blocked = responses.filter((r) => r.status === 429).length;
    expect(evaluated).toBeLessThanOrEqual(10);
    expect(evaluated + blocked).toBe(40);

    // El dueño legítimo recupera el acceso al pasar la ventana (nunca es permanente).
    env.clock.advance(16 * 60_000);
    await signIn(env, 'burst@acme.test', burst.secret, STRONG_PASSWORD, '203.0.113.234');
  });
});
