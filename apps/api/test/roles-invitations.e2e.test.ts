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

// El auditor agrupa las negaciones idénticas dentro de 60 s (ADR 0022); el reloj de pruebas solo
// avanza con los códigos TOTP, así que estas pruebas lo mueven para que cada negación quede como
// evento propio y se pueda contar.
const DENIAL_GROUPING_WINDOW_MS = 61_000;
const leaveDenialGroupingWindow = (): void => {
  env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
};

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

describe('editing custom roles', () => {
  let editable: Role;
  let ownerOnly: Role;

  it('replaces name and permissions, and audits the change without listing permissions', async () => {
    editable = (
      await adminA.client.post<Role>('/roles', {
        name: 'Editable',
        permissions: ['credential.create'],
      })
    ).body;

    const response = await adminA.client.patch<Role>(`/roles/${editable.id}`, {
      name: '  Editado  ',
      permissions: ['account.create', 'account.create'],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: editable.id, name: 'Editado', isSystem: false });
    expect(response.body.permissions).toEqual(['account.create']);
    const listed = (await adminA.client.get<{ data: Role[] }>('/roles')).body.data;
    expect(listed.find((r) => r.id === editable.id)?.permissions).toEqual(['account.create']);

    const events = await env.db.admin.query<{ outcome: string; metadata: Record<string, unknown> }>(
      `select outcome, metadata from audit_events
        where organization_id = $1 and action = 'role.updated' and target_id = $2`,
      [orgId, editable.id],
    );
    expect(events.rows).toEqual([
      { outcome: 'success', metadata: { addedCount: 1, removedCount: 1, renamed: true } },
    ]);
  });

  it('refuses a name already used by another live role, whatever the case', async () => {
    const response = await adminA.client.patch<ProblemDetails>(`/roles/${editable.id}`, {
      name: 'DUEÑO',
      permissions: ['account.create'],
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ROLE.NAME_TAKEN');
  });

  it('lets the role keep its own name when only the permissions change', async () => {
    const response = await adminA.client.patch<Role>(`/roles/${editable.id}`, {
      name: 'editado',
      permissions: ['account.create', 'credential.create'],
    });
    expect(response.status).toBe(200);
  });

  it('refuses to add a permission the editor lacks, and audits the denial', async () => {
    const before = (await audit('authz.denied')).length;
    leaveDenialGroupingWindow();
    const response = await adminA.client.patch<ProblemDetails>(`/roles/${editable.id}`, {
      name: 'Editado',
      permissions: ['account.create', 'org.settings'],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
    const denials = await audit('authz.denied');
    expect(denials.length).toBe(before + 1);
    expect(denials.at(-1)).toEqual({ outcome: 'denied', reason_code: 'AUTHZ.ROLE_ESCALATION' });
  });

  it('refuses to edit a role that holds permissions the editor lacks, even to shrink it', async () => {
    ownerOnly = (
      await root.client.post<Role>('/roles', {
        name: 'Solo raíz',
        permissions: ['org.settings', 'account.create'],
      })
    ).body;

    const before = (await audit('authz.denied')).length;
    leaveDenialGroupingWindow();
    const response = await adminA.client.patch<ProblemDetails>(`/roles/${ownerOnly.id}`, {
      name: 'Solo raíz',
      permissions: ['account.create'],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
    const denials = await audit('authz.denied');
    expect(denials.length).toBe(before + 1);
    expect(denials.at(-1)).toEqual({ outcome: 'denied', reason_code: 'AUTHZ.ROLE_ESCALATION' });
    const stored = (await root.client.get<{ data: Role[] }>('/roles')).body.data.find(
      (r) => r.id === ownerOnly.id,
    );
    expect([...(stored?.permissions ?? [])].sort()).toEqual(['account.create', 'org.settings']);
  });

  it('cannot be done without role.manage, on system templates or on unknown/archived roles', async () => {
    const payload = { name: 'Otro', permissions: ['account.create'] };
    expect((await operator.client.patch(`/roles/${editable.id}`, payload)).status).toBe(403);

    const system = (await adminA.client.get<{ data: Role[] }>('/roles')).body.data.find(
      (r) => r.isSystem,
    );
    const deniedBefore = (await audit('authz.denied')).length;
    leaveDenialGroupingWindow();
    const systemAttempt = await adminA.client.patch<ProblemDetails>(
      `/roles/${system?.id ?? ''}`,
      payload,
    );
    expect(systemAttempt.status).toBe(403);
    expect(systemAttempt.body.code).toBe('ROLE.SYSTEM_PROTECTED');
    const denials = await audit('authz.denied');
    expect(denials.length).toBe(deniedBefore + 1);
    expect(denials.at(-1)).toEqual({ outcome: 'denied', reason_code: 'ROLE.SYSTEM_PROTECTED' });

    expect(
      (await adminA.client.patch('/roles/0194f3a0-0000-7000-8000-000000000000', payload)).status,
    ).toBe(404);
    expect((await adminA.client.post(`/roles/${editable.id}/archive`)).status).toBe(204);
    expect((await adminA.client.patch(`/roles/${editable.id}`, payload)).status).toBe(404);
  });

  it('does not see or change a role of another organization', async () => {
    const other = await env.bootstrapOrganization({
      slug: 'ri-other',
      rootEmail: 'root@ri-other.test',
      rootName: 'Grace Hopper',
    });
    expect(other.organizationId).not.toBe(orgId);
    const client = new TestClient(env, '203.0.113.81');
    await client.post('/auth/login', { email: 'root@ri-other.test', password: STRONG_PASSWORD });
    const otherRoot = await enroll(env, client);

    const response = await otherRoot.client.patch(`/roles/${ownerOnly.id}`, {
      name: 'Secuestrado',
      permissions: ['account.create'],
    });

    expect(response.status).toBe(404);
    const stored = (await root.client.get<{ data: Role[] }>('/roles')).body.data.find(
      (r) => r.id === ownerOnly.id,
    );
    expect(stored?.name).toBe('Solo raíz');
  });

  it('validates the body like creation does', async () => {
    const empty = await adminA.client.patch(`/roles/${ownerOnly.id}`, {
      name: 'X',
      permissions: [],
    });
    expect(empty.status).toBe(422);
    const unknown = await adminA.client.patch(`/roles/${ownerOnly.id}`, {
      name: 'X',
      permissions: ['everything.all'],
    });
    expect(unknown.status).toBe(422);
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

describe('paginated lists (keyset cursor)', () => {
  type RolePage = { data: Role[]; page: { nextCursor: string | null; limit: number } };
  type InvitationPage = {
    data: PendingInvitation[];
    page: { nextCursor: string | null; limit: number };
  };

  const encodeCursor = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  it('walks every role exactly once, system templates first, then custom ones by name', async () => {
    for (let index = 0; index < 12; index += 1) {
      const name = `Paginado ${String(index).padStart(2, '0')}`;
      const response = await adminA.client.post<Role>('/roles', {
        name,
        permissions: ['credential.create'],
      });
      expect(response.status, name).toBe(201);
    }

    const everything = await adminA.client.get<RolePage>('/roles?limit=100');
    expect(everything.body.page.nextCursor).toBeNull();

    const walked: Role[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response: { status: number; body: RolePage } = await adminA.client.get<RolePage>(
        `/roles?limit=10${suffix}`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
      walked.push(...response.body.data);
      cursor = response.body.page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);

    expect(pages).toBeGreaterThan(1);
    expect(walked.map((role) => role.id)).toEqual(everything.body.data.map((role) => role.id));
    expect(new Set(walked.map((role) => role.id)).size).toBe(walked.length);
    const firstCustom = walked.findIndex((role) => !role.isSystem);
    expect(walked.slice(0, firstCustom).every((role) => role.isSystem)).toBe(true);
    expect(walked.slice(firstCustom).every((role) => !role.isSystem)).toBe(true);
  });

  it('a tampered role cursor falls back to the first page instead of failing', async () => {
    const first = await adminA.client.get<RolePage>('/roles?limit=10');
    const uuid = '0198cccc-0000-7000-8000-000000000001';
    const tampered = [
      encodeCursor(['2', 'x', uuid]), // grupo de orden fuera de 0/1
      encodeCursor(['1', 'ab\u0000cd', uuid]), // NUL: PostgreSQL lo rechaza en texto
      encodeCursor(['1', 'x', 'not-a-uuid']),
      encodeCursor(['1', 'x']), // forma incompleta
      encodeCursor({ not: 'a tuple' }),
      'not-base64-at-all!!!',
    ];
    for (const cursor of tampered) {
      const response = await adminA.client.get<RolePage>(
        `/roles?limit=10&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status, cursor).toBe(200);
      expect(
        response.body.data.map((role) => role.id),
        cursor,
      ).toEqual(first.body.data.map((role) => role.id));
    }
  });

  it('rejects a limit outside 10/25/50/100 and ignores sort parameters on fixed-order lists', async () => {
    expect((await adminA.client.get('/roles?limit=7')).status).toBe(422);
    expect((await adminA.client.get('/invitations?limit=7')).status).toBe(422);
    expect((await adminA.client.get('/me/sessions?limit=7')).status).toBe(422);
    expect((await adminA.client.get('/me/passkeys?limit=7')).status).toBe(422);
  });

  it('pages my pending invitations newest first without repeating or skipping any', async () => {
    for (let index = 0; index < 11; index += 1) {
      const email = `page-${String(index).padStart(2, '0')}@ri.test`;
      const response = await adminA.client.post('/invitations', { email, rank: 3, roleIds: [] });
      expect(response.status, email).toBe(201);
    }

    const everything = await adminA.client.get<InvitationPage>('/invitations?limit=100');
    const walked: PendingInvitation[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response: { status: number; body: InvitationPage } =
        await adminA.client.get<InvitationPage>(`/invitations?limit=10${suffix}`);
      expect(response.status).toBe(200);
      walked.push(...response.body.data);
      cursor = response.body.page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);

    expect(pages).toBeGreaterThan(1);
    expect(walked.map((invitation) => invitation.id)).toEqual(
      everything.body.data.map((invitation) => invitation.id),
    );
    const createdAt = walked.map((invitation) => Date.parse(invitation.createdAt));
    expect(createdAt).toEqual([...createdAt].sort((left, right) => right - left));

    // El cursor no da acceso a lo ajeno: otra persona de la misma jerarquía sigue sin ver estas.
    const firstPage = await adminA.client.get<InvitationPage>('/invitations?limit=10');
    const stolen = await adminB.client.get<InvitationPage>(
      `/invitations?limit=10&cursor=${encodeURIComponent(firstPage.body.page.nextCursor ?? '')}`,
    );
    expect(stolen.body.data.map((invitation) => invitation.email)).not.toContain('page-00@ri.test');
  });

  it('a tampered invitations cursor falls back to the first page instead of failing', async () => {
    const first = await adminA.client.get<InvitationPage>('/invitations?limit=10');
    const uuid = '0198cccc-0000-7000-8000-000000000001';
    for (const cursor of [
      encodeCursor(['yesterday', uuid]), // no es una marca de tiempo
      encodeCursor(['2030-01-01 00:00:00+00', 'not-a-uuid']),
      encodeCursor({ not: 'a tuple' }),
      'not-base64-at-all!!!',
    ]) {
      const response = await adminA.client.get<InvitationPage>(
        `/invitations?limit=10&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status, cursor).toBe(200);
      expect(
        response.body.data.map((invitation) => invitation.id),
        cursor,
      ).toEqual(first.body.data.map((invitation) => invitation.id));
    }
  });
});
