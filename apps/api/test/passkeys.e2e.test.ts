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
    expect(
      (await root.client.post('/me/passkeys/0194f3a0-0000-7000-8000-000000000000/revoke')).status,
    ).toBe(404);
    expect((await root.client.post(`/me/passkeys/${laptop?.id ?? ''}/revoke`)).status).toBe(204);
    expect((await audit('auth.passkey_revoked')).map((e) => e.outcome)).toEqual(['success']);

    env.clock.advance(5 * 60 * 1000);
    const { client } = await passwordLogin();
    const options = await loginOptions(client);
    expect(options.allowCredentials?.map((c) => c.id)).not.toContain(key.id);
    expect(
      (await client.post('/auth/passkey/verify', { response: key.authenticate(options) })).status,
    ).toBe(401);
  });
});
