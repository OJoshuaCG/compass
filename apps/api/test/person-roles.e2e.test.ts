import type { PermissionCatalogEntry, PersonRoles, ProblemDetails, Role } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
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
let operator: EnrolledSession;
let operatorId: string;
let operatorRoleId: string;

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; reason_code: string | null }>(
      'select outcome, reason_code from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

const reauth = async (session: EnrolledSession): Promise<void> => {
  const response = await session.client.post('/auth/reauth', {
    code: freshTotp(session.secret, env.clock),
  });
  expect(response.status).toBe(204);
};

const personalRoleRows = async (userId: string) =>
  (
    await env.db.admin.query<{ id: string; permissions: string[]; archived: boolean }>(
      `select id, permissions, archived_at is not null as archived
         from roles where organization_id = $1 and personal_user_id = $2 order by created_at`,
      [orgId, userId],
    )
  ).rows;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'pr',
    rootEmail: 'root@pr.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const client = new TestClient(env, '203.0.113.81');
  await client.post('/auth/login', {
    email: 'root@pr.test',
    password: 'Correct-Horse-Battery-Staple-9',
  });
  root = await enroll(env, client);
  adminA = await inviteAndOnboard(env, root.client, { email: 'a@pr.test', rank: 1 });
  operator = await inviteAndOnboard(env, adminA.client, { email: 'o@pr.test', rank: 3 });
  const me = await env.db.admin.query<{ id: string }>(
    'select id from users where organization_id = $1 and email = $2',
    [orgId, 'o@pr.test'],
  );
  operatorId = me.rows[0]?.id ?? '';
  const roles = await adminA.client.get<{ data: Role[] }>('/roles');
  operatorRoleId =
    roles.body.data.find((role) => role.isSystem && role.name === 'Operator')?.id ?? '';
});

afterAll(async () => {
  await env.close();
});

describe('permission catalog', () => {
  it('lists every permission with its rank ceiling to whoever can invite, and nobody else', async () => {
    const response = await adminA.client.get<{ data: PermissionCatalogEntry[] }>('/permissions');
    expect(response.status).toBe(200);
    const byPermission = new Map(response.body.data.map((e) => [e.permission, e.maxRank]));
    expect(byPermission.get('role.manage')).toBe(1);
    expect(byPermission.get('credential.create')).toBeGreaterThanOrEqual(2);
    expect((await operator.client.get('/permissions')).status).toBe(403);
  });
});

describe('special permissions', () => {
  it('start empty and the person keeps the template role', async () => {
    const response = await adminA.client.get<PersonRoles>(`/users/${operatorId}/roles`);
    expect(response.status).toBe(200);
    expect(response.body.roles.map((role) => role.name)).toEqual(['Operator']);
    expect(response.body.specialPermissions).toEqual([]);
  });

  it('need a recent re-authentication', async () => {
    const response = await adminA.client.post<ProblemDetails>(
      `/users/${operatorId}/special-permissions`,
      { permissions: ['credential.reveal_password'] },
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
  });

  it('are granted through a hidden personal role, and the change is audited', async () => {
    await reauth(adminA);
    const response = await adminA.client.post<PersonRoles>(
      `/users/${operatorId}/special-permissions`,
      { permissions: ['credential.reveal_password', 'credential.reveal_password'] },
    );
    expect(response.status).toBe(200);
    expect(response.body.specialPermissions).toEqual(['credential.reveal_password']);
    expect(response.body.roles.map((role) => role.name)).toEqual(['Operator']);
    expect((await personalRoleRows(operatorId)).map((row) => row.permissions)).toEqual([
      ['credential.reveal_password'],
    ]);
    expect((await audit('user.special_permissions_changed')).map((e) => e.outcome)).toEqual([
      'success',
    ]);
  });

  it('never appear in the role list nor can they be edited as a role', async () => {
    const list = await adminA.client.get<{ data: Role[] }>('/roles');
    expect(
      list.body.data.map((role) => role.name).some((name) => name.startsWith('personal:')),
    ).toBe(false);
    const personalId = (await personalRoleRows(operatorId))[0]?.id ?? '';
    const edit = await adminA.client.patch<ProblemDetails>(`/roles/${personalId}`, {
      name: 'Hack',
      permissions: ['credential.create'],
    });
    expect(edit.status).toBe(404);
    const archive = await adminA.client.post<ProblemDetails>(`/roles/${personalId}/archive`);
    expect(archive.status).toBe(404);
  });

  it('cannot exceed the rank ceiling of the person, and the denial is audited', async () => {
    const before = (await audit('authz.denied')).length;
    const response = await adminA.client.post<ProblemDetails>(
      `/users/${operatorId}/special-permissions`,
      { permissions: ['role.manage'] }, // techo del rango 1; el Operador es rango 3
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.CREATION_NOT_ALLOWED');
    expect((await audit('authz.denied')).length).toBe(before + 1);
  });

  it('cannot grant what the actor lacks (no escalation)', async () => {
    const response = await adminA.client.post<ProblemDetails>(
      `/users/${operatorId}/special-permissions`,
      { permissions: ['org.settings'] }, // un Administrador no tiene org.settings
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
  });

  it('cannot be granted by someone who cannot assign roles, nor to the root user', async () => {
    expect(
      (
        await operator.client.post(`/users/${operatorId}/special-permissions`, {
          permissions: ['credential.reveal_password'],
        })
      ).status,
    ).toBe(403);
    const rootRow = await env.db.admin.query<{ id: string }>(
      'select id from users where organization_id = $1 and email = $2',
      [orgId, 'root@pr.test'],
    );
    const onRoot = await adminA.client.post(
      `/users/${rootRow.rows[0]?.id ?? ''}/special-permissions`,
      {
        permissions: ['credential.reveal_password'],
      },
    );
    expect(onRoot.status).toBe(403);
  });

  it('are removed with an empty set: the personal role is archived and unassigned', async () => {
    const response = await adminA.client.post<PersonRoles>(
      `/users/${operatorId}/special-permissions`,
      { permissions: [] },
    );
    expect(response.status).toBe(200);
    expect(response.body.specialPermissions).toEqual([]);
    expect((await personalRoleRows(operatorId)).map((row) => row.archived)).toEqual([true]);
    const assigned = await env.db.admin.query(
      `select 1 from user_roles ur join roles r on r.id = ur.role_id and r.organization_id = ur.organization_id
        where ur.organization_id = $1 and ur.user_id = $2 and r.personal_user_id is not null`,
      [orgId, operatorId],
    );
    expect(assigned.rowCount).toBe(0);
  });

  it('can be granted again after being removed (a new personal role)', async () => {
    const response = await adminA.client.post<PersonRoles>(
      `/users/${operatorId}/special-permissions`,
      { permissions: ['credential.reveal_password'] },
    );
    expect(response.status).toBe(200);
    expect((await personalRoleRows(operatorId)).map((row) => row.archived)).toEqual([true, false]);
  });
});

describe('role names', () => {
  it('let a custom role use the internal name of a personal role without blocking special permissions', async () => {
    const created = await adminA.client.post<Role>('/roles', {
      name: `personal:${operatorId}`,
      permissions: ['credential.create'],
    });
    expect(created.status).toBe(201);
    const archive = await adminA.client.post(`/roles/${created.body.id}/archive`);
    expect(archive.status).toBe(204);
  });
});

describe('assigned roles', () => {
  let custom: Role;

  it('replace the eligible roles, keep the personal role, and are audited', async () => {
    const created = await adminA.client.post<Role>('/roles', {
      name: 'Contable',
      permissions: ['credential.create', 'account.create'],
    });
    expect(created.status).toBe(201);
    custom = created.body;

    const added = await adminA.client.post<PersonRoles>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId, custom.id],
    });
    expect(added.status).toBe(200);
    expect(added.body.roles.map((role) => role.name).sort()).toEqual(['Contable', 'Operator']);
    expect(added.body.specialPermissions).toEqual(['credential.reveal_password']);

    const removed = await adminA.client.post<PersonRoles>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId],
    });
    expect(removed.body.roles.map((role) => role.name)).toEqual(['Operator']);
    expect((await audit('user.roles_changed')).map((e) => e.outcome)).toEqual([
      'success',
      'success',
    ]);
  });

  it('refuse unknown roles and the personal role of anybody', async () => {
    const unknown = await adminA.client.post<ProblemDetails>(`/users/${operatorId}/roles`, {
      roleIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(unknown.status).toBe(422);
    const personalId = (await personalRoleRows(operatorId)).find((row) => !row.archived)?.id ?? '';
    const personal = await adminA.client.post<ProblemDetails>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId, personalId],
    });
    expect(personal.status).toBe(422);
  });

  it('cannot add a role whose permissions exceed the rank ceiling of the person', async () => {
    const manager = await adminA.client.post<Role>('/roles', {
      name: 'Gestor de roles',
      permissions: ['role.manage'], // techo del rango 1; el Operador es rango 3
    });
    expect(manager.status).toBe(201);
    const response = await adminA.client.post<ProblemDetails>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId, manager.body.id],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.CREATION_NOT_ALLOWED');
  });

  it('cannot be changed on oneself nor on a peer', async () => {
    await inviteAndOnboard(env, root.client, { email: 'b@pr.test', rank: 1 });
    const selfRow = await env.db.admin.query<{ id: string }>(
      'select id from users where organization_id = $1 and email = $2',
      [orgId, 'a@pr.test'],
    );
    const peerRow = await env.db.admin.query<{ id: string }>(
      'select id from users where organization_id = $1 and email = $2',
      [orgId, 'b@pr.test'],
    );
    await reauth(adminA);
    const onSelf = await adminA.client.post(`/users/${selfRow.rows[0]?.id ?? ''}/roles`, {
      roleIds: [operatorRoleId],
    });
    const onPeer = await adminA.client.post(`/users/${peerRow.rows[0]?.id ?? ''}/roles`, {
      roleIds: [operatorRoleId],
    });
    expect(onSelf.status).toBe(403);
    expect(onPeer.status).toBe(403);
  });

  it('can remove a role the actor lacks', async () => {
    // Retirar autoridad nunca escala privilegios. Ningún camino HTTP deja que adminA tenga un rol con
    // `org.settings` en un rango 3, así que el permiso se agrega por la base después de asignar.
    const retirable = await root.client.post<Role>('/roles', {
      name: 'Retirable',
      permissions: ['credential.create'],
    });
    expect(retirable.status).toBe(201);
    await reauth(root);
    expect(
      (
        await root.client.post(`/users/${operatorId}/roles`, {
          roleIds: [operatorRoleId, retirable.body.id],
        })
      ).status,
    ).toBe(200);
    await env.db.admin.query(
      `update roles set permissions = array['credential.create', 'org.settings']
        where id = $1 and organization_id = $2`,
      [retirable.body.id, orgId],
    );
    await reauth(adminA);
    const removed = await adminA.client.post<PersonRoles>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId],
    });
    expect(removed.status).toBe(200);
    expect(removed.body.roles.map((role) => role.name)).toEqual(['Operator']);
  });

  it('cannot add a role above the ceiling or beyond what the actor has', async () => {
    const above = await root.client.post<Role>('/roles', {
      name: 'Dueño',
      permissions: ['org.settings'],
    });
    expect(above.status).toBe(201);
    const response = await adminA.client.post<ProblemDetails>(`/users/${operatorId}/roles`, {
      roleIds: [operatorRoleId, above.body.id],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.ROLE_ESCALATION');
  });
});
