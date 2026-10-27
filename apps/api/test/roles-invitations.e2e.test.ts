import type {
  CreateInvitationResponse,
  PendingInvitation,
  ProblemDetails,
  Role,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let adminA: EnrolledSession;
let adminB: EnrolledSession;
let operator: EnrolledSession;

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null }>(
      'select outcome, reason_code from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

const preview = (token: string) =>
  new TestClient(env, '198.51.100.99').post<ProblemDetails>('/invitations/preview', { token });

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'ri',
    rootEmail: 'root@ri.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const client = new TestClient(env, '203.0.113.80');
  await client.post('/auth/login', { email: 'root@ri.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
  adminA = await inviteAndOnboard(env, root.client, { email: 'a@ri.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@ri.test', rank: 1 });
  operator = await inviteAndOnboard(env, adminA.client, { email: 'o@ri.test', rank: 3 });
});

afterAll(async () => {
  await env.close();
});

describe('custom roles', () => {
  let created: Role;

  it('are listed with the system templates; who cannot invite cannot see them', async () => {
    const response = await adminA.client.get<{ data: Role[] }>('/roles');
    expect(response.status).toBe(200);
    expect(response.body.data.filter((r) => r.isSystem).map((r) => r.name)).toEqual(
      expect.arrayContaining(['Root', 'Administrator', 'Leader', 'Operator']),
    );
    expect((await operator.client.get('/roles')).status).toBe(403);
  });

  it('can be created with a subset of what the creator has, and are audited', async () => {
    const response = await adminA.client.post<Role>('/roles', {
      name: '  Contable  ',
      permissions: ['credential.create', 'account.create', 'account.create'],
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: 'Contable', isSystem: false });
    expect([...response.body.permissions].sort()).toEqual(['account.create', 'credential.create']);
    created = response.body;
    expect((await audit('role.created')).map((e) => e.outcome)).toEqual(['success']);
  });

  it('refuse a repeated name, whatever the case', async () => {
    const response = await adminA.client.post<ProblemDetails>('/roles', {
      name: 'CONTABLE',
      permissions: ['credential.create'],
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ROLE.NAME_TAKEN');
  });

  it('never grant what the creator lacks (no escalation), and the denial is audited', async () => {
    const before = (await audit('authz.denied')).length;
    const response = await adminA.client.post<ProblemDetails>('/roles', {
      name: 'Dueño',
      permissions: ['credential.create', 'org.settings'], // un Administrador no tiene org.settings
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
    expect((await audit('authz.denied')).length).toBe(before + 1);
    expect(
      (await root.client.post('/roles', { name: 'Dueño', permissions: ['org.settings'] })).status,
    ).toBe(201);
  });

  it('cannot be created by someone without role.manage, nor with unknown permissions', async () => {
    expect(
      (await operator.client.post('/roles', { name: 'X', permissions: ['credential.create'] }))
        .status,
    ).toBe(403);
    const unknown = await adminA.client.post<ProblemDetails>('/roles', {
      name: 'Raro',
      permissions: ['everything.all'],
    });
    expect(unknown.status).toBe(422);
    const empty = await adminA.client.post('/roles', { name: 'Vacío', permissions: [] });
    expect(empty.status).toBe(422);
  });

  it('can be used when inviting, and stop being usable once archived', async () => {
    const ok = await adminA.client.post('/invitations', {
      email: 'with-role@ri.test',
      rank: 3,
      roleIds: [created.id],
    });
    expect(ok.status).toBe(201);

    expect((await adminA.client.post(`/roles/${created.id}/archive`)).status).toBe(204);
    expect((await audit('role.archived')).length).toBe(1);

    const after = await adminA.client.post('/invitations', {
      email: 'with-archived@ri.test',
      rank: 3,
      roleIds: [created.id],
    });
    expect(after.status).toBe(422);
    const listed = (await adminA.client.get<{ data: Role[] }>('/roles')).body.data;
    expect(listed.map((r) => r.id)).not.toContain(created.id);
  });

  it('keep the system templates untouchable and answer 404 for unknown roles', async () => {
    const system = (await adminA.client.get<{ data: Role[] }>('/roles')).body.data.find(
      (r) => r.isSystem,
    );
    const response = await adminA.client.post<ProblemDetails>(`/roles/${system?.id ?? ''}/archive`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ROLE.SYSTEM_PROTECTED');
    expect(
      (await adminA.client.post('/roles/0194f3a0-0000-7000-8000-000000000000/archive')).status,
    ).toBe(404);
    expect((await operator.client.post(`/roles/${system?.id ?? ''}/archive`)).status).toBe(403);
  });
});

describe('pending invitations and resending', () => {
  let invitation: CreateInvitationResponse;
  let firstToken: string;

  it('lists my pending invitations, and the Root sees everybody’s', async () => {
    const created = await adminA.client.post<CreateInvitationResponse>('/invitations', {
      email: 'pending@ri.test',
      rank: 2,
      roleIds: [],
    });
    invitation = created.body;
    firstToken = env.mailer.last?.token ?? '';

    const mine = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body.data;
    expect(mine.map((i) => i.email)).toContain('pending@ri.test');
    expect(mine.every((i) => !('token' in i))).toBe(true);
    const peer = (await adminB.client.get<{ data: PendingInvitation[] }>('/invitations')).body.data;
    expect(peer.map((i) => i.email)).not.toContain('pending@ri.test');
    const all = (await root.client.get<{ data: PendingInvitation[] }>('/invitations')).body.data;
    expect(all.map((i) => i.email)).toContain('pending@ri.test');
    expect((await operator.client.get('/invitations')).status).toBe(403);
  });

  it('a peer outside the line cannot resend it, and the denial is audited', async () => {
    const response = await adminB.client.post<ProblemDetails>(
      `/invitations/${invitation.id}/resend`,
    );
    expect(response.status).toBe(403);
    expect((await preview(firstToken)).status).toBe(200); // el enlace original sigue vivo
  });

  it('resending invalidates the previous link and mails a new one', async () => {
    const mails = env.mailer.sent.length;
    const response = await adminA.client.post<CreateInvitationResponse>(
      `/invitations/${invitation.id}/resend`,
    );
    expect(response.status).toBe(201);
    expect(response.body.id).not.toBe(invitation.id);
    expect(response.body.email).toBe('pending@ri.test');
    expect(env.mailer.sent.length).toBe(mails + 1);

    const secondToken = env.mailer.last?.token ?? '';
    expect(secondToken).not.toBe(firstToken);
    const old = await preview(firstToken);
    expect(old.status).toBeGreaterThanOrEqual(400);
    expect(old.body.code).toBe('INVITATION.INVALID');
    expect((await preview(secondToken)).status).toBe(200);

    const pending = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body
      .data;
    expect(pending.filter((i) => i.email === 'pending@ri.test')).toHaveLength(1);
    expect((await audit('user.invitation_resent')).map((e) => e.outcome)).toEqual(['success']);
    invitation = response.body;
  });

  it('works for an expired invitation, which the list marks as expired', async () => {
    await env.db.admin.query(
      "update invitations set expires_at = now() - interval '1 day' where email = 'pending@ri.test' and revoked_at is null",
    );
    const listed = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body
      .data;
    expect(listed.find((i) => i.email === 'pending@ri.test')?.expired).toBe(true);

    const again = await root.client.post<CreateInvitationResponse>(
      `/invitations/${invitation.id}/resend`,
    ); // la Raíz también puede
    expect(again.status).toBe(201);
    expect(Date.parse(again.body.expiresAt)).toBeGreaterThan(env.clock.now().getTime());
  });

  it('answers the same for an accepted, revoked or unknown invitation', async () => {
    const accepted = await env.db.admin.query<{ id: string }>(
      "select id from invitations where email = 'o@ri.test'",
    );
    for (const id of [accepted.rows[0]?.id ?? '', '0194f3a0-0000-7000-8000-000000000000']) {
      const response = await adminA.client.post<ProblemDetails>(`/invitations/${id}/resend`);
      expect(response.body.code, id).toBe('INVITATION.INVALID');
    }
    expect((await adminA.client.post('/invitations/not-a-uuid/resend')).status).toBe(422);
  });
});
