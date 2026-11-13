/**
 * SENSIBLE (ruta protegida: acceso y auditoría). Esta prueba la debe revisar una persona.
 *
 * Grupos con dobles en memoria y la auditoría real (lista blanca incluida): creación con gestor inicial,
 * visibilidad por rango o pertenencia, administración de miembros solo por gestores o Administradores,
 * último gestor protegido y toda negación o éxito auditados.
 */
import type { GroupMemberRole, Permission } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import { RecordAuditEvent } from '../../audit/application/record-audit-event.js';
import { InMemoryAuditEventRepository } from '../../audit/testing/in-memory-audit-event-repository.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { GroupRecord } from '../domain/group-policy.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { ManageGroups } from './manage-groups.js';
import type { GroupMemberRow, GroupStore, GroupSummaryRow } from './ports/group-store.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const ROOT_ID = asUserId('root');
const ADMIN_ID = asUserId('admin');
const LEADER_ID = asUserId('leader');
const OTHER_LEADER_ID = asUserId('other-leader');
const OPERATOR_ID = asUserId('operator');
const SUSPENDED_ID = asUserId('suspended');

const person = (id: UserId, rank: Rank, status: UserRecord['status'] = 'active'): UserRecord => ({
  id,
  organizationId: ORGANIZATION_ID,
  email: `${id}@example.test`,
  displayName: id,
  rank,
  status,
  managedBy: null,
  createdBy: null,
  locale: 'es-MX',
  timezone: 'America/Mexico_City',
});

class InMemoryGroupStore implements GroupStore {
  readonly groups: GroupRecord[] = [];
  readonly memberships: { groupId: string; userId: string; role: GroupMemberRole }[] = [];
  private counter = 0;

  insertGroup(input: { name: string; description: string | null; createdBy: string }) {
    const taken = this.groups.some(
      (group) => group.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (taken) return Promise.resolve(null);
    this.counter += 1;
    const group: GroupRecord = {
      id: `group-${String(this.counter)}`,
      name: input.name,
      description: input.description,
      createdBy: input.createdBy,
      createdAt: new Date('2026-11-13T12:00:00.000Z'),
    };
    this.groups.push(group);
    return Promise.resolve(group);
  }
  findLiveForUpdate(groupId: string) {
    return Promise.resolve(this.groups.find((group) => group.id === groupId) ?? null);
  }
  findLive(groupId: string) {
    return this.findLiveForUpdate(groupId);
  }
  listLive(input: { viewerId: string; onlyOfViewer: boolean; onlyManagedByViewer: boolean }) {
    const rows: GroupSummaryRow[] = [];
    for (const group of this.groups) {
      const own = this.memberships.find(
        (membership) => membership.groupId === group.id && membership.userId === input.viewerId,
      );
      if (input.onlyOfViewer && own === undefined) continue;
      if (input.onlyManagedByViewer && own?.role !== 'manager') continue;
      rows.push({
        ...group,
        memberCount: this.memberships.filter((m) => m.groupId === group.id).length,
        roleOfViewer: own?.role ?? null,
      });
    }
    return Promise.resolve(rows);
  }
  roleOf(groupId: string, userId: string) {
    const found = this.memberships.find((m) => m.groupId === groupId && m.userId === userId);
    return Promise.resolve(found?.role ?? null);
  }
  listMembers(groupId: string) {
    const rows: GroupMemberRow[] = this.memberships
      .filter((m) => m.groupId === groupId)
      .map((m) => ({
        userId: m.userId,
        displayName: m.userId,
        role: m.role,
        addedAt: new Date('2026-11-13T12:00:00.000Z'),
      }));
    return Promise.resolve(rows);
  }
  addMember(input: { groupId: string; userId: string; role: GroupMemberRole }) {
    if (this.memberships.some((m) => m.groupId === input.groupId && m.userId === input.userId)) {
      return Promise.resolve(false);
    }
    this.memberships.push({ groupId: input.groupId, userId: input.userId, role: input.role });
    return Promise.resolve(true);
  }
  removeMember(groupId: string, userId: string) {
    const index = this.memberships.findIndex((m) => m.groupId === groupId && m.userId === userId);
    if (index >= 0) this.memberships.splice(index, 1);
    return Promise.resolve();
  }
  countManagers(groupId: string) {
    return Promise.resolve(
      this.memberships.filter((m) => m.groupId === groupId && m.role === 'manager').length,
    );
  }
}

function setup() {
  let actorId: UserId = LEADER_ID;
  const directory = new InMemoryUserDirectory();
  for (const user of [
    person(ROOT_ID, 0),
    person(ADMIN_ID, 1),
    person(LEADER_ID, 2),
    person(OTHER_LEADER_ID, 2),
    person(OPERATOR_ID, 3),
    person(SUSPENDED_ID, 2, 'suspended'),
  ]) {
    directory.add(user);
  }
  const context = () => ({
    organizationId: ORGANIZATION_ID,
    actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt: null,
  });
  const auditRepository = new InMemoryAuditEventRepository();
  let nextId = 0;
  const audit = new RecordAuditEvent({
    repository: auditRepository,
    context: { current: context },
    ids: { next: () => `audit-${String((nextId += 1))}` },
  });
  const permissions = new Map<UserId, ReadonlySet<Permission>>();
  const auditDenial = vi.fn(() => Promise.resolve());
  const store = new InMemoryGroupStore();
  const uow: UnitOfWork = { run: (fn) => fn(), runIndependent: (fn) => fn() };
  const manage = new ManageGroups({
    context: { current: context },
    uow,
    authorizer: {
      // Doble del motor: solo concede lo que la prueba le dio a esa persona.
      require: (request) =>
        permissions.get(actorId)?.has(request.permission) === true
          ? Promise.resolve(undefined)
          : Promise.reject(new Error('AUTHZ.PERMISSION')),
      auditDenial,
      actorPermissions: () => Promise.resolve(permissions.get(actorId) ?? new Set()),
      requireActiveMember: async () => {
        const actor = await directory.findById(actorId);
        if (actor === null) throw new Error('missing actor');
        return actor;
      },
    },
    directory,
    store,
    audit,
  });
  const grantGroupPermissions = (id: UserId) =>
    permissions.set(id, new Set<Permission>(['group.create', 'group.manage_members']));
  grantGroupPermissions(ROOT_ID);
  grantGroupPermissions(ADMIN_ID);
  grantGroupPermissions(LEADER_ID);
  grantGroupPermissions(OTHER_LEADER_ID);
  return {
    manage,
    store,
    auditDenial,
    audit: auditRepository,
    permissions,
    actAs: (id: UserId) => {
      actorId = id;
    },
  };
}

const actions = (repository: InMemoryAuditEventRepository): string[] =>
  repository.events.map((event) => event.action);

describe('creating a group', () => {
  it('makes the creator its manager and audits the creation', async () => {
    const t = setup();
    const outcome = await t.manage.create({ name: 'Redes Marca MX' });
    expect(outcome.ok).toBe(true);
    expect(t.store.memberships).toEqual([
      { groupId: 'group-1', userId: LEADER_ID, role: 'manager' },
    ]);
    expect(actions(t.audit)).toEqual(['group.created']);
  });

  it('refuses a live name already taken, ignoring case, and creates nothing else', async () => {
    const t = setup();
    await t.manage.create({ name: 'Redes' });
    const outcome = await t.manage.create({ name: 'REDES' });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'GROUP.NAME_TAKEN' } });
    expect(t.store.groups).toHaveLength(1);
    expect(actions(t.audit)).toEqual(['group.created']);
  });

  it('is refused without the group.create permission and writes nothing', async () => {
    const t = setup();
    t.actAs(OPERATOR_ID);
    await expect(t.manage.create({ name: 'Intruso' })).rejects.toThrow('AUTHZ.PERMISSION');
    expect(t.store.groups).toHaveLength(0);
    expect(t.audit.events).toHaveLength(0);
  });
});

describe('listing groups', () => {
  it('shows every group to an Administrator and only their own to a person without group permissions', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    t.actAs(OTHER_LEADER_ID);
    await t.manage.create({ name: 'B' });
    t.actAs(ADMIN_ID);
    expect((await t.manage.list({ managedByMe: false })).map((g) => g.name)).toEqual(['A', 'B']);
    t.actAs(OPERATOR_ID);
    expect(await t.manage.list({ managedByMe: false })).toEqual([]);
  });

  it('narrows to the groups the person manages when asked (sharing selector)', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    t.actAs(OTHER_LEADER_ID);
    await t.manage.create({ name: 'B' });
    const mine = await t.manage.list({ managedByMe: true });
    expect(mine.map((g) => g.name)).toEqual(['B']);
    expect(mine[0]).toMatchObject({
      memberCount: 1,
      roleOfViewer: 'manager',
      canManageMembers: true,
    });
  });

  it('hides a group from a non-member without group permissions as not found', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    t.actAs(OPERATOR_ID);
    expect(await t.manage.listMembers('group-1')).toMatchObject({
      ok: false,
      error: { code: 'GROUP.NOT_FOUND' },
    });
    expect(t.auditDenial).toHaveBeenCalledTimes(1);
  });
});

describe('managing members', () => {
  it('lets the group manager add a member and audits it', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    const outcome = await t.manage.addMember('group-1', OPERATOR_ID, 'member');
    expect(outcome.ok).toBe(true);
    expect(await t.store.roleOf('group-1', OPERATOR_ID)).toBe('member');
    expect(actions(t.audit)).toEqual(['group.created', 'group.member_added']);
  });

  it('lets an Administrator who is not a member manage any group', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    t.actAs(ADMIN_ID);
    expect((await t.manage.addMember('group-1', OPERATOR_ID, 'member')).ok).toBe(true);
  });

  it('refuses a Leader who does not manage the group, as not found, and audits the denial', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    t.actAs(OTHER_LEADER_ID);
    const outcome = await t.manage.addMember('group-1', OPERATOR_ID, 'member');
    expect(outcome).toMatchObject({ ok: false, error: { code: 'GROUP.NOT_FOUND' } });
    expect(t.auditDenial).toHaveBeenCalledTimes(1);
    expect(await t.store.roleOf('group-1', OPERATOR_ID)).toBeNull();
  });

  it.each([
    ['an unknown person', asUserId('ghost'), 'member' as const],
    ['a suspended person', SUSPENDED_ID, 'member' as const],
    ['an Operator as manager', OPERATOR_ID, 'manager' as const],
  ])('refuses %s', async (_label, target, role) => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    const outcome = await t.manage.addMember('group-1', target, role);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'GROUP.MEMBER_INVALID' } });
    expect(actions(t.audit)).toEqual(['group.created']);
  });

  it('refuses adding someone twice', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    await t.manage.addMember('group-1', OPERATOR_ID, 'member');
    expect(await t.manage.addMember('group-1', OPERATOR_ID, 'member')).toMatchObject({
      ok: false,
      error: { code: 'GROUP.MEMBER_EXISTS' },
    });
  });

  it('removes a member and audits it, but never the last manager', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    await t.manage.addMember('group-1', OPERATOR_ID, 'member');
    expect((await t.manage.removeMember('group-1', OPERATOR_ID)).ok).toBe(true);
    expect(await t.manage.removeMember('group-1', LEADER_ID)).toMatchObject({
      ok: false,
      error: { code: 'GROUP.LAST_MANAGER' },
    });
    expect(await t.store.roleOf('group-1', LEADER_ID)).toBe('manager');
    expect(actions(t.audit)).toEqual([
      'group.created',
      'group.member_added',
      'group.member_removed',
    ]);
  });

  it('allows removing a manager when another remains', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    await t.manage.addMember('group-1', OTHER_LEADER_ID, 'manager');
    expect((await t.manage.removeMember('group-1', LEADER_ID)).ok).toBe(true);
  });

  it('answers not found when removing someone who is not a member', async () => {
    const t = setup();
    await t.manage.create({ name: 'A' });
    expect(await t.manage.removeMember('group-1', OPERATOR_ID)).toMatchObject({
      ok: false,
      error: { code: 'GROUP.NOT_FOUND' },
    });
  });
});
