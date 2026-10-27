import type { ManagedUser, ProblemDetails } from '@iam/contracts';
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
let adminA: EnrolledSession;
let adminB: EnrolledSession;
let leader1: EnrolledSession;
let leader3: EnrolledSession;
let operator1: EnrolledSession;
let operator2: EnrolledSession;
let rootId: string;

const idOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const row = async (email: string) =>
  (
    await env.db.admin.query<{ status: string; rank: number; managed_by: string | null }>(
      'select status, rank, managed_by from users where email = $1',
      [email],
    )
  ).rows[0];

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null; metadata: unknown }>(
      'select outcome, reason_code, metadata from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

const reauth = (who: EnrolledSession) =>
  who.client.post('/auth/reauth', { code: freshTotp(who.secret, env.clock) });

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'team',
    rootEmail: 'root@team.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  rootId = created.rootUserId;

  const rootClient = new TestClient(env, '203.0.113.50');
  await rootClient.post('/auth/login', { email: 'root@team.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  adminA = await inviteAndOnboard(env, root.client, { email: 'a@team.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@team.test', rank: 1 });
  leader1 = await inviteAndOnboard(env, adminA.client, { email: 'l1@team.test', rank: 2 });
  await inviteAndOnboard(env, adminA.client, { email: 'l2@team.test', rank: 2 });
  leader3 = await inviteAndOnboard(env, adminA.client, { email: 'l3@team.test', rank: 2 });
  operator1 = await inviteAndOnboard(env, leader1.client, { email: 'o1@team.test', rank: 3 });
  operator2 = await inviteAndOnboard(env, leader3.client, { email: 'o2@team.test', rank: 3 });
  // Una invitación pendiente que deja el Líder 3 (no se acepta).
  await leader3.client.post('/invitations', { email: 'pending@team.test', rank: 3, roleIds: [] });
});

afterAll(async () => {
  await env.close();
});

describe('the managed list shows only the people under your responsibility', () => {
  const emails = async (who: EnrolledSession) => {
    const response = await who.client.get<{ data: ManagedUser[] }>('/users/managed?limit=50');
    expect(response.status).toBe(200);
    return response.body.data.map((u) => u.email).sort();
  };

  it('the Root sees everybody else, whatever their status', async () => {
    expect(await emails(root)).toEqual(
      ['a', 'b', 'l1', 'l2', 'l3', 'o1', 'o2'].map((n) => `${n}@team.test`),
    );
  });

  it('an Administrator sees only their own subtree, never a peer or their branch', async () => {
    expect(await emails(adminA)).toEqual(
      ['l1', 'l2', 'l3', 'o1', 'o2'].map((n) => `${n}@team.test`),
    );
    expect(await emails(adminB)).toEqual([]);
  });

  it('a Leader sees their reports; an Operator sees nobody', async () => {
    expect(await emails(leader1)).toEqual(['o1@team.test']);
    expect(await emails(operator1)).toEqual([]);
  });

  it('includes status and responsible', async () => {
    const response = await adminA.client.get<{ data: ManagedUser[] }>('/users/managed?q=o1');
    expect(response.body.data[0]).toMatchObject({
      email: 'o1@team.test',
      status: 'active',
      rank: 3,
      managedBy: await idOf('l1@team.test'),
    });
  });
});

describe('suspend and reactivate', () => {
  it('suspending closes the sessions of the person at once and is audited', async () => {
    const target = await idOf('o1@team.test');
    expect((await operator1.client.get('/me')).status).toBe(200);

    expect((await adminA.client.post(`/users/${target}/suspend`)).status).toBe(204);

    expect((await row('o1@team.test'))?.status).toBe('suspended');
    expect((await operator1.client.get('/me')).status).toBe(401);
    const open = await env.db.admin.query(
      'select 1 from sessions where user_id = $1 and revoked_at is null',
      [target],
    );
    expect(open.rowCount).toBe(0);
    expect((await audit('user.suspended')).map((e) => e.outcome)).toEqual(['success']);
  });

  it('suspending someone already suspended is a state conflict', async () => {
    const target = await idOf('o1@team.test');
    const response = await adminA.client.post<ProblemDetails>(`/users/${target}/suspend`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('USER.INVALID_STATE');
  });

  it('reactivating brings them back to active; reactivating an active person is a conflict', async () => {
    const target = await idOf('o1@team.test');
    expect((await adminA.client.post(`/users/${target}/reactivate`)).status).toBe(204);
    expect((await row('o1@team.test'))?.status).toBe('active');
    expect((await audit('user.reactivated')).length).toBe(1);

    const again = await adminA.client.post<ProblemDetails>(`/users/${target}/reactivate`);
    expect(again.status).toBe(409);
  });
});

describe('who may act on whom', () => {
  it('a peer Administrator cannot touch someone outside their subtree, and the denial is audited', async () => {
    const before = (await audit('authz.denied')).length;
    const target = await idOf('l1@team.test');
    const response = await adminB.client.post<ProblemDetails>(`/users/${target}/suspend`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
    expect((await row('l1@team.test'))?.status).toBe('active');
    expect((await audit('authz.denied')).length).toBe(before + 1);
  });

  it('an Operator lacks the permission, even over nobody in particular', async () => {
    const target = await idOf('l1@team.test');
    const response = await operator2.client.post<ProblemDetails>(`/users/${target}/suspend`);
    expect(response.status).toBe(403);
  });

  it('nobody can suspend, deactivate, demote or transfer the Root, not even themselves', async () => {
    for (const actor of [root, adminA]) {
      for (const [action, body] of [
        ['suspend', {}],
        ['deactivate', {}],
        ['rank', { rank: 1 }],
        ['manager', { managerId: await idOf('a@team.test') }],
      ] as const) {
        const response = await actor.client.post<ProblemDetails>(
          `/users/${rootId}/${action}`,
          body,
        );
        expect(response.status).toBe(403);
      }
    }
    expect((await row('root@team.test'))?.status).toBe('active');
  });

  it('refuses a malformed identifier before reaching any rule', async () => {
    const response = await adminA.client.post<ProblemDetails>('/users/not-a-uuid/suspend');
    expect(response.status).toBe(422);
  });
});

describe('deactivating a person', () => {
  it('reassigns their reports to their responsible, revokes sessions and pending invitations, and audits', async () => {
    const leaderId = await idOf('l3@team.test');
    const adminId = await idOf('a@team.test');
    expect((await row('o2@team.test'))?.managed_by).toBe(leaderId);

    expect((await adminA.client.post(`/users/${leaderId}/deactivate`)).status).toBe(204);

    expect((await row('l3@team.test'))?.status).toBe('deactivated');
    expect((await row('o2@team.test'))?.managed_by).toBe(adminId);
    expect((await leader3.client.get('/me')).status).toBe(401);
    const pending = await env.db.admin.query<{ revoked_at: Date | null }>(
      "select revoked_at from invitations where email = 'pending@team.test'",
    );
    expect(pending.rows[0]?.revoked_at).not.toBeNull();
    const events = await audit('user.deactivated');
    expect(events.map((e) => e.outcome)).toEqual(['success']);
    expect(events[0]?.metadata).toMatchObject({ reassignedReports: 1 });
  });

  it('a deactivated person can be neither suspended nor deactivated again', async () => {
    const leaderId = await idOf('l3@team.test');
    for (const action of ['suspend', 'deactivate']) {
      const response = await adminA.client.post<ProblemDetails>(`/users/${leaderId}/${action}`);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('USER.INVALID_STATE');
    }
  });
});

describe('changing a rank', () => {
  it('requires a recent reauthentication', async () => {
    const target = await idOf('l2@team.test');
    const response = await root.client.post<ProblemDetails>(`/users/${target}/rank`, { rank: 3 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
    expect((await row('l2@team.test'))?.rank).toBe(2);
  });

  it('lowers someone without reports and audits the change', async () => {
    const target = await idOf('l2@team.test');
    expect((await reauth(root)).status).toBe(204);
    expect((await root.client.post(`/users/${target}/rank`, { rank: 3 })).status).toBe(204);
    expect((await row('l2@team.test'))?.rank).toBe(3);
    expect((await audit('user.rank_changed'))[0]?.metadata).toMatchObject({
      fromRank: 2,
      toRank: 3,
    });
  });

  it('blocks lowering someone who still has reports', async () => {
    const target = await idOf('l1@team.test');
    const response = await root.client.post<ProblemDetails>(`/users/${target}/rank`, { rank: 3 });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('USER.HAS_REPORTS');
    expect((await row('l1@team.test'))?.rank).toBe(2);
  });

  it('never lets someone reach the rank of their responsible or above', async () => {
    const target = await idOf('l1@team.test'); // responsable: Administrador (rango 1)
    const response = await root.client.post<ProblemDetails>(`/users/${target}/rank`, { rank: 1 });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('USER.MANAGER_RANK_INVALID');
  });

  it('an Administrator cannot change ranks: the permission is not theirs', async () => {
    const target = await idOf('l1@team.test');
    const response = await adminA.client.post<ProblemDetails>(`/users/${target}/rank`, { rank: 3 });
    expect(response.status).toBe(403);
  });
});

describe('transferring the responsible', () => {
  it('moves a person under another responsible of the actor’s own subtree', async () => {
    const target = await idOf('o1@team.test');
    const newManager = await idOf('a@team.test');
    expect(
      (await adminA.client.post(`/users/${target}/manager`, { managerId: newManager })).status,
    ).toBe(204);
    expect((await row('o1@team.test'))?.managed_by).toBe(newManager);
    expect((await audit('user.manager_changed'))[0]?.metadata).toMatchObject({
      newManagerId: newManager,
    });
  });

  it('refuses a new responsible outside the actor’s subtree', async () => {
    const target = await idOf('o1@team.test');
    const response = await adminA.client.post<ProblemDetails>(`/users/${target}/manager`, {
      managerId: await idOf('b@team.test'),
    });
    expect(response.status).toBe(403);
    expect((await row('o1@team.test'))?.managed_by).toBe(await idOf('a@team.test'));
  });

  it('refuses a responsible with the same or less authority than the person', async () => {
    const target = await idOf('o1@team.test');
    const response = await adminA.client.post<ProblemDetails>(`/users/${target}/manager`, {
      managerId: await idOf('l2@team.test'), // ahora Operador (rango 3), igual que el objetivo
    });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('USER.MANAGER_RANK_INVALID');
  });

  it('refuses a deactivated or unknown new responsible without revealing which', async () => {
    const target = await idOf('o1@team.test');
    for (const managerId of [await idOf('l3@team.test'), '0194f3a0-0000-7000-8000-000000000000']) {
      const response = await adminA.client.post<ProblemDetails>(`/users/${target}/manager`, {
        managerId,
      });
      expect(response.status).toBe(403);
    }
  });
});
