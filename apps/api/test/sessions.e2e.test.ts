import type { ProblemDetails, SessionSummary } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  signIn,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let adminA: EnrolledSession;
let adminB: EnrolledSession;
let operator: EnrolledSession;
let operatorSecondDevice: TestClient;

const idOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string }>(
      'select outcome from audit_events where organization_id = $1 and action = $2',
      [orgId, action],
    )
  ).rows;

const mine = async (client: TestClient) =>
  (await client.get<{ data: SessionSummary[] }>('/me/sessions')).body.data;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'sess',
    rootEmail: 'root@sess.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const rootClient = new TestClient(env, '203.0.113.60');
  await rootClient.post('/auth/login', { email: 'root@sess.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);
  adminA = await inviteAndOnboard(env, root.client, { email: 'a@sess.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@sess.test', rank: 1 });
  operator = await inviteAndOnboard(env, adminA.client, { email: 'o@sess.test', rank: 3 });
  operatorSecondDevice = await signIn(
    env,
    'o@sess.test',
    operator.secret,
    STRONG_PASSWORD,
    '198.51.100.77',
  );
});

afterAll(async () => {
  await env.close();
});

describe('my sessions', () => {
  it('lists only my live sessions, marks the current one and never exposes tokens', async () => {
    const sessions = await mine(operator.client);

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    for (const session of sessions) {
      expect(Object.keys(session).sort()).toEqual(
        ['createdAt', 'current', 'expiresAt', 'id', 'ip', 'lastSeenAt', 'userAgent'].sort(),
      );
    }
    const adminSessions = await mine(adminA.client);
    expect(adminSessions).toHaveLength(1);
    expect(adminSessions.map((s) => s.id)).not.toContain(sessions[0]?.id);
  });

  it('closes another of my sessions: that browser loses access at once, and it is audited', async () => {
    const other = (await mine(operator.client)).find((s) => !s.current);
    expect(other).toBeDefined();

    const response = await operator.client.post(`/me/sessions/${other?.id ?? ''}/revoke`);

    expect(response.status).toBe(204);
    expect((await operatorSecondDevice.get('/me')).status).toBe(401);
    expect((await operator.client.get('/me')).status).toBe(200);
    expect(await mine(operator.client)).toHaveLength(1);
    expect((await audit('auth.session_revoked')).map((e) => e.outcome)).toEqual(['success']);
  });

  it('answers the same for a closed, unknown or someone else’s session, and never touches it', async () => {
    const victim = (await mine(adminA.client))[0];
    for (const id of [victim?.id ?? '', '0194f3a0-0000-7000-8000-000000000000']) {
      const response = await operator.client.post<ProblemDetails>(`/me/sessions/${id}/revoke`);
      expect(response.status).toBe(404);
    }
    expect((await adminA.client.get('/me')).status).toBe(200);
  });

  it('does not close the current session here, and rejects a malformed identifier', async () => {
    const current = (await mine(operator.client)).find((s) => s.current);
    const own = await operator.client.post<ProblemDetails>(
      `/me/sessions/${current?.id ?? ''}/revoke`,
    );
    expect(own.status).toBe(422);
    expect((await operator.client.get('/me')).status).toBe(200);
    expect((await operator.client.post('/me/sessions/not-a-uuid/revoke')).status).toBe(422);
  });
});

describe('a manager closes every session of a person under their responsibility', () => {
  it('refuses a peer outside the subtree, and the person without permission', async () => {
    const target = await idOf('o@sess.test');
    expect((await adminB.client.post(`/users/${target}/sessions/revoke`)).status).toBe(403);
    expect((await operator.client.post(`/users/${target}/sessions/revoke`)).status).toBe(403);
    expect((await operator.client.get('/me')).status).toBe(200);
  });

  it('never touches the Root', async () => {
    const rootId = await idOf('root@sess.test');
    const response = await adminA.client.post<ProblemDetails>(`/users/${rootId}/sessions/revoke`);
    expect(response.status).toBe(403);
    expect((await root.client.get('/me')).status).toBe(200);
  });

  it('closes them all in the same transaction as its audit entry', async () => {
    const target = await idOf('o@sess.test');
    const again = await signIn(
      env,
      'o@sess.test',
      operator.secret,
      STRONG_PASSWORD,
      '198.51.100.78',
    );
    expect((await again.get('/me')).status).toBe(200);

    expect((await adminA.client.post(`/users/${target}/sessions/revoke`)).status).toBe(204);

    expect((await operator.client.get('/me')).status).toBe(401);
    expect((await again.get('/me')).status).toBe(401);
    const open = await env.db.admin.query(
      'select 1 from sessions where user_id = $1 and revoked_at is null',
      [target],
    );
    expect(open.rowCount).toBe(0);
    expect((await audit('user.sessions_revoked')).map((e) => e.outcome)).toEqual(['success']);
  });
});

describe('what counts as a live session', () => {
  it('leaves out a session that went idle while the active one stays listed', async () => {
    const idle = await signIn(env, 'root@sess.test', root.secret, STRONG_PASSWORD, '198.51.100.80');
    expect(await mine(root.client)).toHaveLength(2);

    env.clock.advance(20 * 60 * 1000);
    expect((await root.client.get('/me')).status).toBe(200); // renueva la actividad de esta
    env.clock.advance(15 * 60 * 1000);

    const live = await mine(root.client);
    expect(live).toHaveLength(1);
    expect(live[0]?.current).toBe(true);
    expect((await idle.get('/me')).status).toBe(401);
  });
});

describe('paginating my sessions', () => {
  type Page = { data: SessionSummary[]; page: { nextCursor: string | null } };

  // Las pruebas anteriores adelantan el reloj compartido: se parte de sesiones recién abiertas.
  let client: TestClient;

  beforeAll(async () => {
    for (let index = 0; index < 11; index += 1) {
      client = await signIn(
        env,
        'b@sess.test',
        adminB.secret,
        STRONG_PASSWORD,
        `198.51.100.${String(100 + index)}`,
      );
    }
  });

  it('walks every live session once, newest created first, even if one is touched meanwhile', async () => {
    const everything = await client.get<Page>('/me/sessions?limit=100');
    expect(everything.body.data.length).toBeGreaterThan(10);

    const firstPage = await client.get<Page>('/me/sessions?limit=10');
    expect(firstPage.body.page.nextCursor).not.toBeNull();
    // Tocar una sesión (last_seen_at) entre páginas no debe moverla de lugar en el recorrido.
    // Con la hora del reloj de prueba: la vigencia por inactividad se calcula con él, no con `now()`.
    await env.db.admin.query('update sessions set last_seen_at = $2 where id = $1', [
      everything.body.data.at(-1)?.id ?? '',
      env.clock.now(),
    ]);
    const secondPage = await client.get<Page>(
      `/me/sessions?limit=10&cursor=${encodeURIComponent(firstPage.body.page.nextCursor ?? '')}`,
    );
    const walked = [...firstPage.body.data, ...secondPage.body.data].map((s) => s.id);
    expect(walked).toEqual(everything.body.data.map((s) => s.id));
    const created = everything.body.data.map((s) => Date.parse(s.createdAt));
    expect(created).toEqual([...created].sort((left, right) => right - left));
  });

  it('a tampered cursor falls back to the first page instead of failing', async () => {
    const first = await client.get<Page>('/me/sessions?limit=10');
    const uuid = '0198cccc-0000-7000-8000-000000000001';
    for (const value of [
      ['yesterday', uuid],
      ['2030-01-01 00:00:00+00', 'not-a-uuid'],
      { not: 'a tuple' },
    ]) {
      const cursor = Buffer.from(JSON.stringify(value)).toString('base64url');
      const response = await client.get<Page>(
        `/me/sessions?limit=10&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.map((s) => s.id)).toEqual(first.body.data.map((s) => s.id));
    }
  });
});
