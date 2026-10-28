import type { Passkey, ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  APP_ORIGIN,
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';
import { VirtualAuthenticator } from './support/virtual-authenticator.js';
import type {
  AuthenticationOptions,
  RegistrationOptions,
} from './support/virtual-authenticator.js';

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let key: VirtualAuthenticator;
let ipCounter = 100;

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string }>(
      'select outcome from audit_events where organization_id = $1 and action = $2',
      [orgId, action],
    )
  ).rows;
const nextIp = () => `203.0.113.${String(ipCounter++)}`;
const reauth = (who: EnrolledSession) =>
  who.client.post('/auth/reauth', { code: freshTotp(who.secret, env.clock) });
const passwordLogin = async () => {
  const client = new TestClient(env, nextIp());
  const response = await client.post<{ status: string; passkeys?: boolean }>('/auth/login', {
    email: 'root@pk.test',
    password: STRONG_PASSWORD,
  });
  return { client, response };
};
/** Registra una llave de acceso con la sesión completa de la Raíz (incluye la reautenticación). */
async function registerKey(authenticator: VirtualAuthenticator, name = 'Laptop') {
  expect((await reauth(root)).status).toBe(204);
  const options = await root.client.post<RegistrationOptions>('/me/passkeys/registration/options');
  expect(options.status).toBe(200);
  return root.client.post<Passkey>('/me/passkeys/registration/verify', {
    name,
    response: authenticator.register(options.body),
  });
}
const loginOptions = async (client: TestClient) => {
  const response = await client.post<AuthenticationOptions>('/auth/passkey/options');
  expect(response.status).toBe(200);
  return response.body;
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'pk',
    rootEmail: 'root@pk.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  root = await enroll(env, (await passwordLogin()).client);
  key = new VirtualAuthenticator(APP_ORIGIN);
});

afterAll(async () => {
  await env.close();
});

describe('registering a passkey', () => {
  it('needs a recent re-authentication, and a half session cannot even ask', async () => {
    const withoutReauth = await root.client.post<ProblemDetails>(
      '/me/passkeys/registration/options',
    );
    expect(withoutReauth.status).toBe(403);
    expect(withoutReauth.body.code).toBe('AUTHZ.REAUTH_REQUIRED');

    const { client } = await passwordLogin(); // solo contraseña
    expect((await client.post('/me/passkeys/registration/options')).status).toBe(403);
    expect((await client.get('/me/passkeys')).status).toBe(403);
  });

  it('stores the passkey and lists it without its public key or credential id', async () => {
    const created = await registerKey(key, 'Laptop');
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Laptop');

    const list = await root.client.get<{ data: Passkey[] }>('/me/passkeys');
    expect(list.body.data).toHaveLength(1);
    expect(Object.keys(list.body.data[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastUsedAt',
      'name',
    ]);
    expect(JSON.stringify(list.body)).not.toContain(key.id);
    expect((await audit('auth.passkey_registered')).map((e) => e.outcome)).toEqual(['success']);
    // La persona recibe un aviso con el tipo de cambio, sin que se confunda con una invitación.
    expect(env.mailer.notices).toEqual([
      expect.objectContaining({ kind: 'passkey_added', to: 'root@pk.test' }),
    ]);
    expect(env.mailer.sent).toHaveLength(0);
  });

  it('refuses the same credential twice, a replayed challenge and a missing user verification', async () => {
    expect((await reauth(root)).status).toBe(204);
    const options = await root.client.post<RegistrationOptions>(
      '/me/passkeys/registration/options',
    );

    const duplicate = await root.client.post<ProblemDetails>('/me/passkeys/registration/verify', {
      name: 'Again',
      response: key.register(options.body),
    });
    expect(duplicate.status).toBe(422);

    // El desafío ya se usó: reutilizarlo con una llave nueva tampoco sirve.
    const fresh = new VirtualAuthenticator(APP_ORIGIN);
    const replay = await root.client.post('/me/passkeys/registration/verify', {
      name: 'Replay',
      response: fresh.register(options.body),
    });
    expect(replay.status).toBe(422);

    const options2 = await root.client.post<RegistrationOptions>(
      '/me/passkeys/registration/options',
    );
    const noUv = await root.client.post('/me/passkeys/registration/verify', {
      name: 'No UV',
      response: fresh.register(options2.body, { userVerified: false }),
    });
    expect(noUv.status).toBe(422);
    expect((await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data).toHaveLength(1);
  });

  it('caps the number of passkeys per person', async () => {
    for (let i = 0; i < 9; i += 1) {
      expect(
        (await registerKey(new VirtualAuthenticator(APP_ORIGIN), `Key ${String(i)}`)).status,
      ).toBe(201);
    }
    expect((await reauth(root)).status).toBe(204);
    const over = await root.client.post<ProblemDetails>('/me/passkeys/registration/options');
    expect(over.status).toBe(422);
  });
});

describe('the cap is enforced when registering, not only when asking', () => {
  it('refuses to finish a registration when the limit was reached in between, and audits it', async () => {
    const list = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data;
    const spare = list.find((p) => p.name === 'Key 0');
    expect((await reauth(root)).status).toBe(204);
    expect((await root.client.post(`/me/passkeys/${spare?.id ?? ''}/revoke`)).status).toBe(204);

    expect((await reauth(root)).status).toBe(204);
    const options = await root.client.post<RegistrationOptions>(
      '/me/passkeys/registration/options',
    );
    expect(options.status).toBe(200); // 9 vigentes: aún cabe una

    // Otra alta ocupa el último lugar entre pedir las opciones y terminar.
    await env.db.admin.query(
      `insert into webauthn_credentials (organization_id, user_id, credential_id, public_key, name)
       select organization_id, id, $1, '\\x01', 'Direct' from users where email = 'root@pk.test'`,
      [Buffer.from(`direct-${String(Date.now())}`)],
    );
    const before = (await audit('auth.passkey_registration_failed')).length;
    const late = await root.client.post<ProblemDetails>('/me/passkeys/registration/verify', {
      name: 'Late',
      response: new VirtualAuthenticator(APP_ORIGIN).register(options.body),
    });

    expect(late.status).toBe(422);
    expect((await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data).toHaveLength(10);
    expect((await audit('auth.passkey_registration_failed')).length).toBe(before + 1);
  });
});

describe('signing in with a passkey', () => {
  it('replaces the code: password, then a verified signature, then a full session', async () => {
    const { client, response } = await passwordLogin();
    expect(response.body).toEqual({ status: 'mfa_required', passkeys: true });
    expect((await client.get('/me')).status).toBe(403);

    const options = await loginOptions(client);
    expect(options.allowCredentials?.map((c) => c.id)).toContain(key.id);
    const verified = await client.post('/auth/passkey/verify', {
      response: key.authenticate(options),
    });

    expect(verified.status).toBe(204);
    expect((await client.get('/me')).status).toBe(200);
    expect((await audit('auth.passkey_login')).map((e) => e.outcome)).toEqual(['success']);
    const list = await root.client.get<{ data: Passkey[] }>('/me/passkeys');
    expect(list.body.data.find((p) => p.name === 'Laptop')?.lastUsedAt).not.toBeNull();
  });

  it('rejects a replayed assertion, a stale counter, a foreign signature and a missing verification', async () => {
    const { client } = await passwordLogin();
    const options = await loginOptions(client);
    const good = key.authenticate(options);
    expect((await client.post('/auth/passkey/verify', { response: good })).status).toBe(204);

    const { client: second } = await passwordLogin();
    await loginOptions(second);
    // El mismo desafío ya no existe para esta sesión y la respuesta anterior no corresponde.
    expect((await second.post('/auth/passkey/verify', { response: good })).status).toBe(401);

    env.clock.advance(5 * 60 * 1000); // pasa el bloqueo temporal de los fallos
    const options3 = await loginOptions(second);
    const stale = key.authenticate(options3, { counter: 1 }); // el contador no avanza
    expect((await second.post('/auth/passkey/verify', { response: stale })).status).toBe(401);

    env.clock.advance(5 * 60 * 1000);
    const options4 = await loginOptions(second);
    const foreign = key.authenticate(options4, { signWith: VirtualAuthenticator.foreignKey() });
    expect((await second.post('/auth/passkey/verify', { response: foreign })).status).toBe(401);

    env.clock.advance(5 * 60 * 1000);
    const options5 = await loginOptions(second);
    const noUv = key.authenticate(options5, { userVerified: false });
    expect((await second.post('/auth/passkey/verify', { response: noUv })).status).toBe(401);
    expect((await second.get('/me')).status).toBe(403);
  });

  it('a challenge belongs to the session that asked for it: another session cannot burn it', async () => {
    env.clock.advance(2 * 60 * 1000); // pasa la espera por fallos de pruebas anteriores
    const { client: victim } = await passwordLogin();
    const { client: attacker } = await passwordLogin();
    const options = await loginOptions(victim);
    const assertion = key.authenticate(options);

    // Quien solo conoce la contraseña no puede gastar el desafío de la víctima.
    expect((await attacker.post('/auth/passkey/verify', { response: assertion })).status).toBe(401);
    env.clock.advance(60 * 1000);
    expect((await victim.post('/auth/passkey/verify', { response: assertion })).status).toBe(204);
  });

  it('only one challenge is live per session: asking again replaces the previous one', async () => {
    env.clock.advance(2 * 60 * 1000); // pasa la espera por fallos de pruebas anteriores
    const { client } = await passwordLogin();
    const first = await loginOptions(client);
    const second = await loginOptions(client);
    expect(second.challenge).not.toBe(first.challenge);
    const newAssertion = key.authenticate(second);

    expect((await client.post('/auth/passkey/verify', { response: newAssertion })).status).toBe(
      204,
    );
    env.clock.advance(60 * 1000);
    // Firmada después (contador mayor): solo la puede rechazar el desafío ya reemplazado.
    const oldAssertion = key.authenticate(first);
    expect((await client.post('/auth/passkey/verify', { response: oldAssertion })).status).toBe(
      401,
    );
  });

  it('a challenge expires after five minutes', async () => {
    const { client } = await passwordLogin();
    const options = await loginOptions(client);
    const assertion = key.authenticate(options);
    env.clock.advance(6 * 60 * 1000);
    expect((await client.post('/auth/passkey/verify', { response: assertion })).status).toBe(401);
  });

  it('a registration challenge cannot be used to sign in (purpose is bound)', async () => {
    // La Raíz ya tiene 10 llaves: libera un lugar para poder pedir opciones de registro.
    const spare = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data.find(
      (p) => p.name === 'Key 1',
    );
    expect((await reauth(root)).status).toBe(204);
    expect((await root.client.post(`/me/passkeys/${spare?.id ?? ''}/revoke`)).status).toBe(204);
    expect((await reauth(root)).status).toBe(204);
    const registration = await root.client.post<RegistrationOptions>(
      '/me/passkeys/registration/options',
    );
    // La misma sesión intenta entrar con el desafío de registro como si fuera de autenticación.
    const forged = key.authenticate({
      challenge: registration.body.challenge,
      rpId: registration.body.rp.id,
    });
    env.clock.advance(60 * 1000);
    expect((await root.client.post('/auth/passkey/verify', { response: forged })).status).toBe(401);
  });

  it('a credential the person does not own is refused', async () => {
    const { client } = await passwordLogin();
    env.clock.advance(5 * 60 * 1000);
    const options = await loginOptions(client);
    const stranger = new VirtualAuthenticator(APP_ORIGIN);
    expect(
      (await client.post('/auth/passkey/verify', { response: stranger.authenticate(options) }))
        .status,
    ).toBe(401);
  });

  it('repeated failures hit the temporary lock', async () => {
    const { client } = await passwordLogin();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const options = await client.post<AuthenticationOptions>('/auth/passkey/options');
      if (options.status === 200) {
        const stranger = new VirtualAuthenticator(APP_ORIGIN);
        statuses.push(
          (
            await client.post('/auth/passkey/verify', {
              response: stranger.authenticate(options.body),
            })
          ).status,
        );
      } else {
        statuses.push(options.status);
      }
    }
    expect(statuses).toContain(429);
  });
});

describe('a person without passkeys, and revoking them', () => {
  it('a person without passkeys is told so at sign-in, and asking for options is just a failure', async () => {
    const guest = await inviteAndOnboard(env, root.client, { email: 'guest@pk.test', rank: 1 });
    const client = new TestClient(env, nextIp());
    const login = await client.post<{ status: string; passkeys?: boolean }>('/auth/login', {
      email: 'guest@pk.test',
      password: STRONG_PASSWORD,
    });
    expect(login.body).toEqual({ status: 'mfa_required', passkeys: false });
    const options = await client.post<ProblemDetails>('/auth/passkey/options');
    expect(options.status).toBe(401);
    // Una llave de la Raíz no sirve para entrar como otra persona.
    const rootOptions = await loginOptions((await passwordLogin()).client);
    expect(
      (await client.post('/auth/passkey/verify', { response: key.authenticate(rootOptions) }))
        .status,
    ).toBe(401);
    expect((await guest.client.get('/me')).status).toBe(200);

    // Ni puede quitarle su llave a la Raíz: para quien no es dueña, la llave no existe.
    const laptop = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data[0];
    expect((await reauth(guest)).status).toBe(204);
    expect((await guest.client.post(`/me/passkeys/${laptop?.id ?? ''}/revoke`)).status).toBe(404);
    expect(
      (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data.length,
    ).toBeGreaterThan(0);
  });

  it('revoking needs re-authentication, only reaches my own passkeys and stops them working', async () => {
    expect((await root.client.get('/me')).status).toBe(200); // mantiene viva la sesión
    env.clock.advance(16 * 60 * 1000); // pasa el bloqueo temporal de las pruebas anteriores
    expect((await root.client.get('/me')).status).toBe(200);
    const list = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data;
    const laptop = list.find((p) => p.name === 'Laptop');

    const noReauth = await root.client.post<ProblemDetails>(
      `/me/passkeys/${laptop?.id ?? ''}/revoke`,
    );
    expect(noReauth.status).toBe(403);

    expect((await reauth(root)).status).toBe(204);
    const removedBefore = env.mailer.notices.filter((n) => n.kind === 'passkey_removed').length;
    expect(
      (await root.client.post('/me/passkeys/0194f3a0-0000-7000-8000-000000000000/revoke')).status,
    ).toBe(404);
    // Una baja que no ocurrió no se anuncia.
    expect(env.mailer.notices.filter((n) => n.kind === 'passkey_removed')).toHaveLength(
      removedBefore,
    );
    expect((await root.client.post(`/me/passkeys/${laptop?.id ?? ''}/revoke`)).status).toBe(204);
    const removed = env.mailer.notices.filter((n) => n.kind === 'passkey_removed');
    expect(removed).toHaveLength(removedBefore + 1);
    expect(removed.at(-1)?.to).toBe('root@pk.test');
    const revoked = await audit('auth.passkey_revoked');
    expect(revoked.length).toBeGreaterThanOrEqual(3);
    expect(revoked.every((e) => e.outcome === 'success')).toBe(true);
    expect((await audit('auth.passkey_revoke_failed')).length).toBeGreaterThan(0);

    env.clock.advance(5 * 60 * 1000);
    const { client } = await passwordLogin();
    const options = await loginOptions(client);
    expect(options.allowCredentials?.map((c) => c.id)).not.toContain(key.id);
    expect(
      (await client.post('/auth/passkey/verify', { response: key.authenticate(options) })).status,
    ).toBe(401);
  });
});

describe('re-authenticating with a passkey (ADR 0033)', () => {
  it('renews the re-authentication window with a verified signature and audits the method', async () => {
    env.clock.advance(16 * 60 * 1000); // pasa el bloqueo temporal de las pruebas anteriores
    expect((await root.client.get('/me')).status).toBe(200);
    const second = new VirtualAuthenticator(APP_ORIGIN);
    expect((await registerKey(second, 'Reauth key')).status).toBe(201);
    env.clock.advance(6 * 60 * 1000); // vence la ventana de reautenticación
    expect((await root.client.get('/me')).status).toBe(200);
    const spare = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data.find(
      (p) => p.name === 'Reauth key',
    );
    const stale = await root.client.post<ProblemDetails>(`/me/passkeys/${spare?.id ?? ''}/revoke`);
    expect(stale.status).toBe(403);

    const options = await root.client.post<AuthenticationOptions>('/auth/reauth/passkey/options');
    expect(options.status).toBe(200);
    const verified = await root.client.post('/auth/reauth/passkey/verify', {
      response: second.authenticate(options.body),
    });

    expect(verified.status).toBe(204);
    expect((await root.client.post(`/me/passkeys/${spare?.id ?? ''}/revoke`)).status).toBe(204);
    expect((await audit('auth.reauthenticated_passkey')).map((e) => e.outcome)).toEqual([
      'success',
    ]);
  });

  it('a sign-in challenge cannot be redeemed as a re-authentication (purpose is bound)', async () => {
    env.clock.advance(6 * 60 * 1000);
    expect((await root.client.get('/me')).status).toBe(200);
    const signer = new VirtualAuthenticator(APP_ORIGIN);
    expect((await registerKey(signer, 'Purpose key')).status).toBe(201);
    env.clock.advance(6 * 60 * 1000);
    expect((await root.client.get('/me')).status).toBe(200);

    const loginChallenge = await loginOptions(root.client);
    const forged = signer.authenticate(loginChallenge);

    const response = await root.client.post('/auth/reauth/passkey/verify', { response: forged });
    expect(response.status).toBe(401);
  });

  it('audits a failed attempt with its own action, apart from a failed sign-in', async () => {
    const failures = await audit('auth.reauth_failed');

    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((e) => e.outcome === 'failure')).toBe(true);
  });

  it('a half session (password only) can neither ask for nor redeem a passkey re-authentication', async () => {
    const { client } = await passwordLogin();

    expect((await client.post('/auth/reauth/passkey/options')).status).toBe(403);
    expect(
      (
        await client.post('/auth/reauth/passkey/verify', {
          response: { id: 'AAAA', type: 'public-key' },
        })
      ).status,
    ).toBe(403);
  });

  it('a challenge is consumed once: replaying the same assertion fails and is audited', async () => {
    env.clock.advance(16 * 60 * 1000); // pasa el bloqueo temporal de las pruebas anteriores
    expect((await root.client.get('/me')).status).toBe(200);
    const replayer = new VirtualAuthenticator(APP_ORIGIN);
    expect((await registerKey(replayer, 'Replay key')).status).toBe(201);
    env.clock.advance(6 * 60 * 1000);
    expect((await root.client.get('/me')).status).toBe(200);
    const failuresBefore = (await audit('auth.reauth_failed')).length;

    const options = await root.client.post<AuthenticationOptions>('/auth/reauth/passkey/options');
    const assertion = replayer.authenticate(options.body);
    const first = await root.client.post('/auth/reauth/passkey/verify', { response: assertion });
    const second = await root.client.post('/auth/reauth/passkey/verify', { response: assertion });

    expect(first.status).toBe(204);
    expect(second.status).toBe(401);
    expect((await audit('auth.reauth_failed')).length).toBe(failuresBefore + 1);
  });
});

describe('security notices when the passkeys change (TODO G5)', () => {
  const auditMetadata = async (action: string) =>
    (
      await env.db.admin.query<{ metadata: unknown }>(
        'select metadata from audit_events where organization_id = $1 and action = $2 order by seq',
        [orgId, action],
      )
    ).rows.map((r) => r.metadata);

  it('a mail failure never undoes adding or removing a passkey, and leaves an audit event without the address', async () => {
    env.clock.advance(16 * 60 * 1000); // pasa el bloqueo temporal de las pruebas anteriores
    expect((await root.client.get('/me')).status).toBe(200);
    // Las pruebas anteriores dejan llaves vivas: se libera un lugar para no chocar con el tope de 10.
    const live = (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data;
    if (live.length >= 10) {
      expect((await reauth(root)).status).toBe(204);
      expect((await root.client.post(`/me/passkeys/${live[0]?.id ?? ''}/revoke`)).status).toBe(204);
    }
    const failuresBefore = (await audit('auth.security_notice_failed')).length;
    const noticesBefore = env.mailer.notices.length;

    env.mailer.failNext = true;
    const added = await registerKey(new VirtualAuthenticator(APP_ORIGIN), 'Notice key');
    expect(added.status).toBe(201);

    expect((await audit('auth.security_notice_failed')).length).toBe(failuresBefore + 1);
    expect(env.mailer.notices).toHaveLength(noticesBefore);

    expect((await reauth(root)).status).toBe(204);
    env.mailer.failNext = true;
    expect((await root.client.post(`/me/passkeys/${added.body.id}/revoke`)).status).toBe(204);

    const failures = await audit('auth.security_notice_failed');
    expect(failures.length).toBe(failuresBefore + 2);
    expect(failures.every((e) => e.outcome === 'failure')).toBe(true);
    const metadata = await auditMetadata('auth.security_notice_failed');
    expect(metadata.slice(-2)).toEqual([{ kind: 'passkey_added' }, { kind: 'passkey_removed' }]);
    expect(JSON.stringify(metadata)).not.toContain('root@pk.test');
    expect(
      (await root.client.get<{ data: Passkey[] }>('/me/passkeys')).body.data.map((p) => p.name),
    ).not.toContain('Notice key');
  });
});
