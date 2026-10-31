import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  APP_ORIGIN,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';
import { VirtualAuthenticator } from './support/virtual-authenticator.js';
import type { RegistrationOptions } from './support/virtual-authenticator.js';

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
const auditMetadata = async (action: string) =>
  (
    await env.db.admin.query<{ metadata: unknown }>(
      'select metadata from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows.map((r) => r.metadata);
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
    // No avisa a los Administradores, pero la persona sí recibe su aviso (TODO G5).
    expect(env.mailer.notices).toEqual([
      expect.objectContaining({ kind: 'recovery_code_used', to: 'root@em.test' }),
    ]);
  });

  it('a mail failure never blocks an ordinary recovery code and leaves an audit event without the address', async () => {
    const client = await login('203.0.113.88');
    const noticesBefore = env.mailer.notices.length;
    const failuresBefore = (await audit('auth.security_notice_failed')).length;
    env.mailer.failNext = true;

    expect(
      (await client.post('/auth/mfa/recovery', { code: root.recoveryCodes[2] ?? '' })).status,
    ).toBe(204);

    expect(env.mailer.notices).toHaveLength(noticesBefore);
    expect((await audit('auth.security_notice_failed')).length).toBe(failuresBefore + 1);
    const metadata = await auditMetadata('auth.security_notice_failed');
    expect(metadata.at(-1)).toEqual({ kind: 'recovery_code_used' });
    expect(JSON.stringify(metadata)).not.toContain('root@em.test');
  });

  it('a wrong recovery code announces nothing', async () => {
    const client = await login('203.0.113.89');
    const noticesBefore = env.mailer.notices.length;
    expect((await client.post('/auth/mfa/recovery', { code: 'ZZZZ-ZZZZ-ZZZZ' })).status).toBe(401);
    expect(env.mailer.notices).toHaveLength(noticesBefore);
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
    // La Raíz tiene también una llave de acceso (p. ej. en un dispositivo que se perdió).
    const lostKey = new VirtualAuthenticator(APP_ORIGIN);
    expect(
      (await root.client.post('/auth/reauth', { code: freshTotp(root.secret, env.clock) })).status,
    ).toBe(204);
    const regOptions = await root.client.post<RegistrationOptions>(
      '/me/passkeys/registration/options',
    );
    expect(
      (
        await root.client.post('/me/passkeys/registration/verify', {
          name: 'Lost phone',
          response: lostKey.register(regOptions.body),
        })
      ).status,
    ).toBe(201);
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
    // El código de emergencia tiene su propio aviso a los Administradores: no suma otro a la persona.
    expect(env.mailer.notices.filter((n) => n.kind === 'recovery_code_used')).toHaveLength(1);
    // La baja de la app de autenticación se encoló en el outbox en la misma transacción (el correo
    // sale por el trabajador, que aquí no corre): un solo evento, solo con ids, tipo y fecha.
    const queued = await env.db.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from outbox_events where type = 'user.security_notice' and payload->>'userId' = $1",
      [rootId],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]?.payload).toMatchObject({ kind: 'totp_removed' });

    // El código no se reutiliza, y el secreto TOTP anterior ya no sirve.
    const again = await login('203.0.113.95');
    expect((await again.post('/auth/mfa/recovery', { code: emergencyCodes[0] })).status).toBe(401);
    // La llave de acceso anterior ya no sirve: el restablecimiento la revoca junto con el resto.
    const alivePasskeys = await env.db.admin.query(
      'select 1 from webauthn_credentials where user_id = $1 and revoked_at is null',
      [rootId],
    );
    expect(alivePasskeys.rowCount).toBe(0);
    expect((await again.post('/auth/passkey/options')).status).toBe(401);
    // Los códigos ordinarios anteriores también quedaron invalidados, y el factor revocado.
    const oldOrdinary = await again.post('/auth/mfa/recovery', { code: root.recoveryCodes[1] });
    expect(oldOrdinary.status).toBe(401);
    const factors = await env.db.admin.query<{ revoked: boolean }>(
      'select revoked_at is not null as revoked from user_totp_factors where user_id = $1 and verified_at is not null',
      [rootId],
    );
    expect(factors.rows.length).toBeGreaterThan(0);
    expect(factors.rows.every((f) => f.revoked)).toBe(true);
    // El evento crítico cuenta a cuántos Administradores se avisó, y el aviso salió completo.
    expect(
      ((await auditMetadata('auth.emergency_code_used'))[0] as { alertRecipients: number })
        .alertRecipients,
    ).toBe(2);
    expect((await audit('auth.emergency_alert_incomplete')).length).toBe(0);
    const stale = await again.post<ProblemDetails>('/auth/mfa/verify', {
      code: freshTotp(oldSecret, env.clock),
    });
    expect(stale.status).toBeGreaterThanOrEqual(400);
    expect(stale.status).not.toBe(204);

    env.clock.advance(10 * 60 * 1000); // pasa el bloqueo temporal de los intentos fallidos
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
    // Un aviso falló: queda registrado en la auditoría (no se pierde en silencio).
    const incomplete = await auditMetadata('auth.emergency_alert_incomplete');
    expect(incomplete).toEqual([{ recipients: 2, failed: 1 }]);
  });

  it('a session that was already complete goes back to enrollment too', async () => {
    const client = await login('203.0.113.98');
    await enroll(env, client); // sesión completa
    expect((await client.get('/me')).status).toBe(200);

    expect((await client.post('/auth/mfa/recovery', { code: emergencyCodes[3] })).status).toBe(204);

    const me = await client.get<ProblemDetails>('/me');
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('AUTH.ENROLLMENT_REQUIRED');
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
