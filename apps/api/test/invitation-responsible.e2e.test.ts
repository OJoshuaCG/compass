import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Decisión C12-1: quien invita puede definir el responsable de la persona invitada. El responsable
// debe ser quien invita o alguien de su subárbol con más autoridad que el invitado.
let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let adminA: EnrolledSession;
let adminB: EnrolledSession;

const idOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const userRow = async (email: string) =>
  (
    await env.db.admin.query<{ managed_by: string | null; created_by: string | null }>(
      'select managed_by, created_by from users where email = $1',
      [email],
    )
  ).rows[0];

const invitationCount = async (email: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        'select count(*) as n from invitations where organization_id = $1 and email = $2',
        [orgId, email],
      )
    ).rows[0]?.n,
  );

const deniedCount = async (): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        "select count(*) as n from audit_events where organization_id = $1 and action = 'authz.denied'",
        [orgId],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'responsible',
    rootEmail: 'root@responsible.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.60');
  await rootClient.post('/auth/login', {
    email: 'root@responsible.test',
    password: STRONG_PASSWORD,
  });
  root = await enroll(env, rootClient);

  adminA = await inviteAndOnboard(env, root.client, { email: 'a@responsible.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@responsible.test', rank: 1 });
  await inviteAndOnboard(env, adminA.client, { email: 'la@responsible.test', rank: 2 });
  await inviteAndOnboard(env, adminA.client, {
    email: 'la2@responsible.test',
    rank: 2,
  });
  await inviteAndOnboard(env, adminB.client, { email: 'lb@responsible.test', rank: 2 });
});

afterAll(async () => {
  await env.close();
});

describe('the inviter defines the responsible of the invited person', () => {
  it('without managerId the inviter is the responsible, as before', async () => {
    await inviteAndOnboard(env, adminA.client, { email: 'default@responsible.test', rank: 3 });

    const row = await userRow('default@responsible.test');
    expect(row?.managed_by).toBe(await idOf('a@responsible.test'));
    expect(row?.created_by).toBe(await idOf('a@responsible.test'));
  });

  it('accepts someone of the inviter subtree; the creator stays the inviter', async () => {
    await inviteAndOnboard(env, adminA.client, {
      email: 'chosen@responsible.test',
      rank: 3,
      managerId: await idOf('la@responsible.test'),
    });

    const row = await userRow('chosen@responsible.test');
    expect(row?.managed_by).toBe(await idOf('la@responsible.test'));
    expect(row?.created_by).toBe(await idOf('a@responsible.test'));
  });

  it('naming themselves explicitly is the same as omitting it', async () => {
    await inviteAndOnboard(env, adminA.client, {
      email: 'self@responsible.test',
      rank: 3,
      managerId: await idOf('a@responsible.test'),
    });

    expect((await userRow('self@responsible.test'))?.managed_by).toBe(
      await idOf('a@responsible.test'),
    );
  });

  it('refuses a responsible outside the inviter subtree, creates nothing and audits the denial', async () => {
    const before = await deniedCount();

    const response = await adminA.client.post<ProblemDetails>('/invitations', {
      email: 'outside@responsible.test',
      rank: 3,
      roleIds: [],
      managerId: await idOf('lb@responsible.test'),
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
    expect(await invitationCount('outside@responsible.test')).toBe(0);
    expect(await deniedCount()).toBe(before + 1);
  });

  it('refuses a responsible with the same or less authority than the invitee and audits it', async () => {
    const before = await deniedCount();

    const response = await adminA.client.post<ProblemDetails>('/invitations', {
      email: 'peer@responsible.test',
      rank: 2,
      roleIds: [],
      managerId: await idOf('la@responsible.test'), // Líder (rango 2), igual que el invitado
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('USER.MANAGER_RANK_INVALID');
    expect(await invitationCount('peer@responsible.test')).toBe(0);
    expect(await deniedCount()).toBe(before + 1);
  });

  it('answers the same for an out-of-subtree user whatever their rank (no enumeration)', async () => {
    // lb (rango 2) está fuera del subárbol de adminA; con un invitado de rango 2 su rango tampoco
    // alcanza, pero la respuesta no debe delatar que existe ni cuál es su rango.
    const outsideSameRank = await adminA.client.post<ProblemDetails>('/invitations', {
      email: 'probe1@responsible.test',
      rank: 2,
      roleIds: [],
      managerId: await idOf('lb@responsible.test'),
    });
    const unknown = await adminA.client.post<ProblemDetails>('/invitations', {
      email: 'probe2@responsible.test',
      rank: 2,
      roleIds: [],
      managerId: '0194f3a0-0000-7000-8000-000000000001',
    });

    expect(outsideSameRank.status).toBe(403);
    expect(outsideSameRank.body.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
    expect(outsideSameRank.status).toBe(unknown.status);
    expect(outsideSameRank.body.code).toBe(unknown.body.code);
  });

  it('refuses an unknown or suspended responsible without revealing which', async () => {
    const suspended = await idOf('la2@responsible.test');
    expect((await adminA.client.post(`/users/${suspended}/suspend`)).status).toBe(204);

    for (const managerId of [suspended, '0194f3a0-0000-7000-8000-000000000000']) {
      const response = await adminA.client.post<ProblemDetails>('/invitations', {
        email: 'ghost@responsible.test',
        rank: 3,
        roleIds: [],
        managerId,
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('AUTHZ.HIERARCHY.NOT_IN_SUBTREE');
    }
    expect(await invitationCount('ghost@responsible.test')).toBe(0);
  });

  it('lets the Root name anyone active with more authority than the invitee', async () => {
    await inviteAndOnboard(env, root.client, {
      email: 'byroot@responsible.test',
      rank: 3,
      managerId: await idOf('lb@responsible.test'),
    });

    expect((await userRow('byroot@responsible.test'))?.managed_by).toBe(
      await idOf('lb@responsible.test'),
    );
  });

  it('rejects the acceptance when the chosen responsible left the inviter subtree meanwhile', async () => {
    const chosen = await idOf('la@responsible.test');
    const created = await adminA.client.post('/invitations', {
      email: 'late@responsible.test',
      rank: 3,
      roleIds: [],
      managerId: chosen,
    });
    expect(created.status).toBe(201);
    const token = env.mailer.last?.token ?? '';

    // Entre invitar y aceptar, la Raíz traspasa al responsable elegido a la rama del otro Administrador.
    const moved = await root.client.post(`/users/${chosen}/manager`, {
      managerId: await idOf('b@responsible.test'),
    });
    expect(moved.status).toBe(204);

    const guest = new TestClient(env, '198.51.100.21');
    const accepted = await guest.post<ProblemDetails>('/invitations/accept', {
      token,
      displayName: 'Late Person',
      password: STRONG_PASSWORD,
    });

    expect(accepted.status).not.toBe(200);
    expect(accepted.body.code).toBe('INVITATION.INVALID');
    expect(await userRow('late@responsible.test')).toBeUndefined();
  });
});
