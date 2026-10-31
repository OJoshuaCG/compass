import type { DataKeyRotation, ProblemDetails } from '@iam/contracts';
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
let root: EnrolledSession;
let admin: EnrolledSession;
let operator: EnrolledSession;

const reauth = (who: EnrolledSession) =>
  who.client.post('/auth/reauth', { code: freshTotp(who.secret, env.clock) });

const rotate = (who: EnrolledSession, reason: 'scheduled' | 'incident') =>
  who.client.post<DataKeyRotation & ProblemDetails>('/organization/data-key/rotate', { reason });

const audit = async () =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null; metadata: unknown }>(
      "select outcome, reason_code, metadata from audit_events where organization_id = $1 and action = 'crypto.dek_rotated' order by seq",
      [orgId],
    )
  ).rows;

const dataKeyStates = async () =>
  (
    await env.db.admin.query<{ version: number; status: string }>(
      'select version, status from data_keys where organization_id = $1 order by version',
      [orgId],
    )
  ).rows;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'rk',
    rootEmail: 'root@rk.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const client = new TestClient(env, '203.0.113.120');
  await client.post('/auth/login', { email: 'root@rk.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
  admin = await inviteAndOnboard(env, root.client, { email: 'admin@rk.test', rank: 1 });
  operator = await inviteAndOnboard(env, admin.client, { email: 'op@rk.test', rank: 3 });
});

afterAll(async () => {
  await env.close();
});

describe('POST /organization/data-key/rotate', () => {
  it('denies an operator', async () => {
    const response = await rotate(operator, 'scheduled');
    expect(response.status).toBe(403);
    expect(await dataKeyStates()).toEqual([{ version: 1, status: 'active' }]);
  });

  it('requires a recent reauthentication from the administrator', async () => {
    const response = await rotate(admin, 'scheduled');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
    expect(await dataKeyStates()).toEqual([{ version: 1, status: 'active' }]);
    expect(await audit()).toEqual([]);
  });

  it('rotates for an administrator who reauthenticated, and audits only versions and reason', async () => {
    expect((await reauth(admin)).status).toBe(204);
    const response = await rotate(admin, 'scheduled');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fromVersion: 1, toVersion: 2, reason: 'scheduled' });

    expect(await dataKeyStates()).toEqual([
      { version: 1, status: 'retired' },
      { version: 2, status: 'active' },
    ]);
    const events = await audit();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'success',
      metadata: { fromVersion: 1, toVersion: 2, reason: 'scheduled' },
    });
  });

  it('refuses an incident rotation from an administrator: it also needs the Root', async () => {
    env.clock.advance(60_000);
    expect((await reauth(admin)).status).toBe(204);
    const response = await rotate(admin, 'incident');
    expect(response.status).toBe(403);
    expect((await dataKeyStates()).map((state) => state.version)).toEqual([1, 2]);
  });

  it('lets the Root rotate by incident', async () => {
    expect((await reauth(root)).status).toBe(204);
    const response = await rotate(root, 'incident');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fromVersion: 2, toVersion: 3, reason: 'incident' });
    expect((await audit()).map((event) => event.metadata)).toEqual([
      { fromVersion: 1, toVersion: 2, reason: 'scheduled' },
      { fromVersion: 2, toVersion: 3, reason: 'incident' },
    ]);
  });

  it('rejects an unknown reason without rotating', async () => {
    expect((await reauth(root)).status).toBe(204);
    const response = await root.client.post('/organization/data-key/rotate', { reason: 'bored' });
    expect(response.status).toBe(422);
    expect((await dataKeyStates()).map((state) => state.version)).toEqual([1, 2, 3]);
  });
});
