import { createHash } from 'node:crypto';

import type { CreateInvitationResponse, ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;

const KEY = 'invite-key-0001';
const body = (email: string) => ({ email, rank: 1, roleIds: [] as string[] });
const withKey = (key: string) => ({ 'idempotency-key': key });
const rows = async (email: string) =>
  (await env.db.admin.query('select 1 from invitations where email = $1', [email])).rowCount;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'idem',
    rootEmail: 'root@idem.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const client = new TestClient(env, '203.0.113.70');
  await client.post('/auth/login', { email: 'root@idem.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
});

afterAll(async () => {
  await env.close();
});

describe('POST requests that create a resource need an idempotency key', () => {
  it('refuses a request without a key, or with a malformed one', async () => {
    for (const key of ['', 'short', 'has spaces in it!!', 'x'.repeat(201)]) {
      const response = await root.client.post<ProblemDetails>(
        '/invitations',
        body('nokey@idem.test'),
        { 'idempotency-key': key },
      );
      expect(response.status, key).toBe(422);
      expect(response.body.code).toBe('IDEMPOTENCY.KEY_REQUIRED');
    }
    expect(await rows('nokey@idem.test')).toBe(0);
  });

  it('a retry with the same key and request returns the same answer and creates nothing more', async () => {
    const first = await root.client.post<CreateInvitationResponse>(
      '/invitations',
      body('once@idem.test'),
      withKey(KEY),
    );
    const mails = env.mailer.sent.length;
    const retry = await root.client.post<CreateInvitationResponse>(
      '/invitations',
      body('once@idem.test'),
      withKey(KEY),
    );

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(env.mailer.sent.length).toBe(mails); // no segundo correo
    expect(await rows('once@idem.test')).toBe(1);
  });

  it('the same key with a different request is refused and does not run it', async () => {
    const response = await root.client.post<ProblemDetails>(
      '/invitations',
      body('other@idem.test'),
      withKey(KEY),
    );
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('IDEMPOTENCY.KEY_REUSED');
    expect(await rows('other@idem.test')).toBe(0);
  });

  it('a failed request is not remembered: the retry runs again with the same key', async () => {
    const bad = await root.client.post<ProblemDetails>(
      '/invitations',
      { email: 'not-an-email', rank: 1, roleIds: [] },
      withKey('retry-after-fail-1'),
    );
    expect(bad.status).toBe(422);

    const fixed = await root.client.post(
      '/invitations',
      { email: 'not-an-email', rank: 1, roleIds: [] },
      withKey('retry-after-fail-1'),
    );
    expect(fixed.status).toBe(422); // mismo cuerpo: vuelve a ejecutarse (no es KEY_REUSED ni caché)
    const ok = await root.client.post(
      '/invitations',
      body('fixed@idem.test'),
      withKey('retry-after-fail-1'),
    );
    expect(ok.status).toBe(201);
  });
});

describe('what the stored key protects and what it does not', () => {
  it('belongs to its actor: the same key from another person is independent', async () => {
    const other = await invite('actor-b@idem.test');
    const mine = await root.client.post<CreateInvitationResponse>(
      '/invitations',
      body('shared-key-a@idem.test'),
      withKey('same-key-both-1'),
    );
    const theirs = await other.post<CreateInvitationResponse>(
      '/invitations',
      { email: 'shared-key-b@idem.test', rank: 2, roleIds: [] },
      withKey('same-key-both-1'),
    );
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(theirs.body.id).not.toBe(mine.body.id);

    // Cada quien reintenta lo suyo y recibe su propia respuesta, nunca la de la otra persona.
    const retryTheirs = await other.post<CreateInvitationResponse>(
      '/invitations',
      { email: 'shared-key-b@idem.test', rank: 2, roleIds: [] },
      withKey('same-key-both-1'),
    );
    const retryMine = await root.client.post<CreateInvitationResponse>(
      '/invitations',
      body('shared-key-a@idem.test'),
      withKey('same-key-both-1'),
    );
    expect(retryTheirs.body).toEqual(theirs.body);
    expect(retryMine.body).toEqual(mine.body);
  });

  it('a request still in flight answers a conflict instead of running twice', async () => {
    const payload = body('inflight@idem.test');
    const fingerprint = createHash('sha256')
      .update(`POST\n/api/v1/invitations\n${JSON.stringify(payload)}`)
      .digest('hex');
    await env.db.admin.query(
      `insert into idempotency_keys (organization_id, actor_id, key, request_hash, expires_at)
       select $1, id, 'in-flight-key-1', decode($2, 'hex'), $3 from users where rank = 0`,
      [orgId, fingerprint, new Date(env.clock.now().getTime() + 30_000)],
    );

    const response = await root.client.post<ProblemDetails>(
      '/invitations',
      payload,
      withKey('in-flight-key-1'),
    );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('IDEMPOTENCY.IN_PROGRESS');
    expect(await rows('inflight@idem.test')).toBe(0);
  });

  it('an expired reservation no longer replays: the request runs again', async () => {
    const payload = body('expired@idem.test');
    const first = await root.client.post('/invitations', payload, withKey('expiring-key-1'));
    expect(first.status).toBe(201);
    await env.db.admin.query(
      "update idempotency_keys set expires_at = now() - interval '1 hour' where key = 'expiring-key-1'",
    );
    env.clock.advance(1000);

    // Se vuelve a ejecutar: la invitación ya está pendiente, así que responde conflicto en vez de
    // repetir el 201 guardado.
    const second = await root.client.post<ProblemDetails>(
      '/invitations',
      payload,
      withKey('expiring-key-1'),
    );
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('INVITATION.CONFLICT');
  });

  it('several simultaneous retries over an expired reservation run the request exactly once', async () => {
    const payload = body('race@idem.test');
    const first = await root.client.post('/invitations', payload, withKey('race-key-0001'));
    expect(first.status).toBe(201);
    await env.db.admin.query(
      "update idempotency_keys set expires_at = now() - interval '1 hour', status_code = null, response = null where key = 'race-key-0001'",
    );
    await env.db.admin.query(
      "update invitations set revoked_at = now() where email = 'race@idem.test'",
    );
    const mails = env.mailer.sent.length;

    const attempts = await Promise.all(
      [1, 2, 3, 4].map(() =>
        root.client.post<ProblemDetails>('/invitations', payload, withKey('race-key-0001')),
      ),
    );

    // Una sola se ejecutó; las demás reciben la respuesta guardada o un conflicto "en curso".
    const executed = attempts.filter(
      (a) => a.status === 201 && a.headers['idempotent-replayed'] === undefined,
    );
    expect(executed).toHaveLength(1);
    expect(attempts.every((a) => a.status === 201 || a.status === 409)).toBe(true);
    expect(env.mailer.sent.length).toBe(mails + 1);
    expect(
      (
        await env.db.admin.query(
          "select 1 from invitations where email = 'race@idem.test' and revoked_at is null",
        )
      ).rowCount,
    ).toBe(1);
  });

  it('never stores a response body with a secret: an invitation answer has no token', async () => {
    const stored = await env.db.admin.query<{ response: string }>(
      'select response::text as response from idempotency_keys where key = $1',
      [KEY],
    );
    expect(stored.rows[0]?.response).not.toMatch(/token/i);
  });
});

async function invite(email: string): Promise<TestClient> {
  const created = await root.client.post('/invitations', body(email));
  if (created.status !== 201) throw new Error('invite failed');
  const token = env.mailer.last?.token ?? '';
  const guest = new TestClient(env, '198.51.100.90');
  await guest.post('/invitations/accept', {
    token,
    displayName: 'Actor B',
    password: STRONG_PASSWORD,
  });
  await enroll(env, guest);
  return guest;
}
