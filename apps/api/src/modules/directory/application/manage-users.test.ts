import { PERMISSIONS } from '@iam/contracts';
import type { Permission } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DomainError, RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import { RankRoleAdjuster } from '../../access/application/rank-role-adjuster.js';
import { systemRole } from '../../access/domain/system-roles.js';
import { InMemoryRoleRepository } from '../../access/testing/in-memory-role-repository.js';
import { RecordAuditEvent } from '../../audit/application/record-audit-event.js';
import { InMemoryAuditEventRepository } from '../../audit/testing/in-memory-audit-event-repository.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { ManageUsers } from './manage-users.js';
import type { RankChangeNotice } from './ports/rank-change-notice-queue.js';
import type { SharedAccountSummary } from './ports/shared-by-lister.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const NOW = new Date('2026-10-29T12:00:00.000Z');
const SHARE_LIST_LIMIT_IN_RESPONSE = 100;

const ROOT_ID = asUserId('root');
const ADMIN_ID = asUserId('admin');
const OTHER_ADMIN_ID = asUserId('other-admin');
const LEADER_ID = asUserId('leader');
const OPERATOR_ID = asUserId('operator');

const person = (
  id: UserId,
  rank: Rank,
  managedBy: UserId | null,
  status: UserRecord['status'] = 'active',
): UserRecord => ({
  id,
  organizationId: ORGANIZATION_ID,
  email: `${id}@example.test`,
  displayName: id,
  rank,
  status,
  managedBy,
  createdBy: managedBy,
  locale: 'es-MX',
  timezone: 'America/Mexico_City',
});

const LEADER_ROLE = {
  ...roleOf('role-leader', 'Leader', systemRole('leader').permissions),
  isSystem: true,
};
const OPERATOR_ROLE = {
  ...roleOf('role-operator', 'Operator', systemRole('operator').permissions),
  isSystem: true,
};
const CUSTOM_ROLE = roleOf('role-custom', 'Custom', ['account.create']);

function roleOf(id: string, name: string, permissions: readonly Permission[]) {
  return { id, name, isSystem: false, permissions };
}

interface SetupOptions {
  readonly actorId?: UserId;
  readonly users?: readonly UserRecord[];
  readonly sharedAccounts?: readonly SharedAccountSummary[];
  readonly shareTotal?: number;
  /** Permisos efectivos de quien actúa; por defecto todos (como la Raíz). */
  readonly actorPermissions?: readonly Permission[];
}

function setup(options: SetupOptions = {}) {
  const directory = new InMemoryUserDirectory();
  const users = options.users ?? [
    person(ROOT_ID, RANK.ROOT, null),
    person(ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID),
    person(OTHER_ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID),
    person(LEADER_ID, RANK.LEADER, ADMIN_ID),
    // Responde al Administrador y no al Líder: así el Líder no tiene subordinados (bajarlo no choca
    // con USER.HAS_REPORTS) y el Operador puede subir a Líder bajo un responsable de rango 1.
    person(OPERATOR_ID, RANK.OPERATOR, ADMIN_ID),
  ];
  for (const user of users) directory.add(user);

  const roles = new InMemoryRoleRepository();
  roles.addRole(LEADER_ROLE);
  roles.addRole(OPERATOR_ROLE);
  roles.addRole(CUSTOM_ROLE);
  roles.grant(LEADER_ID, LEADER_ROLE.id);
  roles.grant(LEADER_ID, CUSTOM_ROLE.id);

  const auditRepository = new InMemoryAuditEventRepository();
  let nextId = 0;
  const audit = new RecordAuditEvent({
    repository: auditRepository,
    context: { current: () => context() },
    ids: { next: () => `audit-${String((nextId += 1))}` },
  });
  const actorId = options.actorId ?? ROOT_ID;
  const context = () => ({
    organizationId: ORGANIZATION_ID,
    actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt: null,
  });

  const notices: RankChangeNotice[] = [];
  const revokeAllOfUser = vi.fn(() => Promise.resolve());
  const auditDenial = vi.fn(() => Promise.resolve());
  const require = vi.fn(() => Promise.resolve(undefined));
  const actorPermissions = vi.fn(() =>
    Promise.resolve<ReadonlySet<Permission>>(new Set(options.actorPermissions ?? PERMISSIONS)),
  );
  const uow: UnitOfWork = { run: (fn) => fn(), runIndependent: (fn) => fn() };
  const sharedAccounts = options.sharedAccounts ?? [];
  const listLiveGrantedBy = vi.fn(() =>
    Promise.resolve({ total: options.shareTotal ?? sharedAccounts.length, rows: sharedAccounts }),
  );

  const manageUsers = new ManageUsers({
    context: { current: context },
    uow,
    authorizer: { require, auditDenial, actorPermissions },
    directory,
    sessions: { revokeAllOfUser },
    invitations: { revokePendingOfUser: () => Promise.resolve() },
    roles: new RankRoleAdjuster({ roles }),
    sharedBy: { listLiveGrantedBy },
    rankChangeNotices: {
      enqueue: (notice) => {
        notices.push(notice);
        return Promise.resolve();
      },
    },
    audit,
    clock: { now: () => NOW },
  });
  return {
    manageUsers,
    directory,
    roles,
    auditEvents: auditRepository.events,
    notices,
    revokeAllOfUser,
    auditDenial,
    require,
    listLiveGrantedBy,
  };
}

const rankOf = (directory: InMemoryUserDirectory, id: UserId): Rank | undefined =>
  directory.users.get(id)?.rank;

describe('ManageUsers.changeRank: roles above the new ceiling', () => {
  it('removes the roles that exceed the new rank and keeps the rest', async () => {
    const { manageUsers, roles, directory } = setup();

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removedRoles).toEqual([{ id: LEADER_ROLE.id, name: 'Leader' }]);
    // La persona conserva el rol personalizado (cabe en el techo de Operador): no se le asigna plantilla.
    expect(result.value.assignedRole).toBeNull();
    expect([...(roles.assignments.get(LEADER_ID) ?? [])]).toEqual([CUSTOM_ROLE.id]);
    expect(rankOf(directory, LEADER_ID)).toBe(RANK.OPERATOR);
  });

  it('assigns the template of the new rank when the cut leaves no role at all', async () => {
    const { manageUsers, roles } = setup();
    // Sin el rol personalizado, el recorte deja a la persona sin ningún rol vigente.
    roles.assignments.get(LEADER_ID)?.delete(CUSTOM_ROLE.id);

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removedRoles.map((role) => role.id)).toEqual([LEADER_ROLE.id]);
    expect(result.value.assignedRole).toEqual({ id: OPERATOR_ROLE.id, name: 'Operator' });
    expect(result.value.templateSkipped).toBe(false);
    expect([...(roles.assignments.get(LEADER_ID) ?? [])]).toEqual([OPERATOR_ROLE.id]);
  });

  // SENSIBLE (revisión humana): no escalamiento (ADR 0012); sin los permisos de la plantilla no se asigna.
  it('does NOT assign the template when the actor lacks one of its permissions', async () => {
    const operatorPermissions = [...systemRole('operator').permissions];
    const missingPermission = operatorPermissions[0];
    const { manageUsers, roles, auditEvents } = setup({
      actorPermissions: operatorPermissions.filter(
        (permission) => permission !== missingPermission,
      ),
    });
    roles.assignments.get(LEADER_ID)?.delete(CUSTOM_ROLE.id);

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removedRoles.map((role) => role.id)).toEqual([LEADER_ROLE.id]);
    expect(result.value.assignedRole).toBeNull();
    expect(result.value.templateSkipped).toBe(true);
    expect([...(roles.assignments.get(LEADER_ID) ?? [])]).toEqual([]);
    const event = auditEvents.find((candidate) => candidate.action === 'user.rank_changed');
    expect(event?.metadata).toMatchObject({ assignedRole: null, templateSkipped: true });
  });

  // SENSIBLE (revisión humana): un actor sin ningún permiso tampoco puede otorgar la plantilla.
  it('does NOT assign the template when the actor has no permissions at all', async () => {
    const { manageUsers, roles } = setup({ actorPermissions: [] });
    roles.assignments.get(LEADER_ID)?.delete(CUSTOM_ROLE.id);

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok && result.value.templateSkipped).toBe(true);
    expect([...(roles.assignments.get(LEADER_ID) ?? [])]).toEqual([]);
  });

  it('does not flag a skipped template when the person keeps another role', async () => {
    const { manageUsers } = setup({ actorPermissions: [] });

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok && result.value.templateSkipped).toBe(false);
  });

  it('does not touch roles when the rank goes up', async () => {
    const { manageUsers, roles } = setup();
    roles.grant(OPERATOR_ID, OPERATOR_ROLE.id);

    const result = await manageUsers.changeRank(OPERATOR_ID, RANK.LEADER, 'Takes over the team');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removedRoles).toEqual([]);
    expect(result.value.assignedRole).toBeNull();
    expect([...(roles.assignments.get(OPERATOR_ID) ?? [])]).toEqual([OPERATOR_ROLE.id]);
  });

  it('writes a single audit event with ids, counts and no role names', async () => {
    const { manageUsers, auditEvents } = setup({ sharedAccounts: [], shareTotal: 3 });

    await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR, '  Moves to field work  ');

    const events = auditEvents.filter((event) => event.action === 'user.rank_changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({
      fromRank: RANK.LEADER,
      toRank: RANK.OPERATOR,
      reason: 'Moves to field work',
      removedRoles: LEADER_ROLE.id,
      removedRoleCount: 1,
      assignedRole: null,
      templateSkipped: false,
      sharedAccountCount: 3,
    });
  });

  it('queues the notice with the actor and both ranks, never the reason', async () => {
    const { manageUsers, notices } = setup();

    await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR, 'private reason');

    expect(notices).toEqual([
      {
        targetId: LEADER_ID,
        changedBy: ROOT_ID,
        fromRank: RANK.LEADER,
        toRank: RANK.OPERATOR,
        changedAt: NOW,
      },
    ]);
    expect(JSON.stringify(notices)).not.toContain('private reason');
  });

  it('closes the sessions of the person in the same operation', async () => {
    const { manageUsers, revokeAllOfUser } = setup();

    await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(revokeAllOfUser).toHaveBeenCalledWith(LEADER_ID, NOW);
  });
});

describe('ManageUsers.changeRank: shared accounts are reported, never revoked', () => {
  const share: SharedAccountSummary = {
    shareId: 'share-1',
    accountId: 'account-1',
    granteeType: 'user',
    granteeId: 'grantee-1',
    level: 'VIEW',
    expiresAt: null,
  };

  it('returns the live shares and the real total when lowering the rank', async () => {
    const { manageUsers, listLiveGrantedBy } = setup({ sharedAccounts: [share], shareTotal: 250 });

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok && result.value.sharedAccounts).toEqual([share]);
    expect(result.ok && result.value.sharedAccountCount).toBe(250);
    expect(listLiveGrantedBy).toHaveBeenCalledWith(LEADER_ID, NOW, SHARE_LIST_LIMIT_IN_RESPONSE);
  });

  // SENSIBLE (revisión humana): el detalle de comparticiones exige permiso sobre la bóveda.
  it.each<Permission>(['vault.inventory.read', 'share.manage'])(
    'returns the share list when the actor holds %s',
    async (permission) => {
      const { manageUsers } = setup({ sharedAccounts: [share], actorPermissions: [permission] });

      const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

      expect(result.ok && result.value.sharedAccounts).toEqual([share]);
    },
  );

  // SENSIBLE (revisión humana): sin permiso sobre la bóveda solo se devuelve el conteo.
  it('returns only the count when the actor has no vault permission', async () => {
    const { manageUsers, auditEvents } = setup({
      sharedAccounts: [share],
      shareTotal: 4,
      actorPermissions: ['user.change_rank', 'role.assign'],
    });

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok && result.value.sharedAccounts).toEqual([]);
    expect(result.ok && result.value.sharedAccountCount).toBe(4);
    const event = auditEvents.find((candidate) => candidate.action === 'user.rank_changed');
    expect(event?.metadata).toMatchObject({ sharedAccountCount: 4 });
  });

  it('does not look at shares when the rank goes up', async () => {
    const { manageUsers, listLiveGrantedBy } = setup({ sharedAccounts: [share] });

    const result = await manageUsers.changeRank(OPERATOR_ID, RANK.LEADER, 'Promotion');

    expect(result.ok && result.value.sharedAccountCount).toBe(0);
    expect(listLiveGrantedBy).not.toHaveBeenCalled();
  });
});

describe('ManageUsers.changeRank: same rank and reason', () => {
  it('rejects the same rank as an invalid state without writing anything', async () => {
    const { manageUsers, auditEvents, revokeAllOfUser } = setup();

    const result = await manageUsers.changeRank(LEADER_ID, RANK.LEADER);

    expect(!result.ok && result.error.code).toBe('USER.INVALID_STATE');
    expect(auditEvents).toHaveLength(0);
    expect(revokeAllOfUser).not.toHaveBeenCalled();
  });

  // SENSIBLE (revisión humana): el motivo es obligatorio solo al subir la autoridad.
  it('requires a reason to promote and audits the denial', async () => {
    const { manageUsers, directory, auditDenial, notices } = setup();

    for (const reason of [undefined, '', '   ']) {
      const result = await manageUsers.changeRank(OPERATOR_ID, RANK.LEADER, reason);
      expect(!result.ok && result.error.code).toBe('USER.RANK_REASON_REQUIRED');
    }

    expect(rankOf(directory, OPERATOR_ID)).toBe(RANK.OPERATOR);
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'USER.RANK_REASON_REQUIRED',
      permission: 'user.change_rank',
      targetUserId: OPERATOR_ID,
    });
    expect(notices).toHaveLength(0);
  });

  it('does not require a reason to lower the rank and stores null', async () => {
    const { manageUsers, auditEvents } = setup();

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok).toBe(true);
    expect(auditEvents[0]?.metadata).toMatchObject({ reason: null });
  });

  it('keeps long id lists inside the audit limit and the real count apart', async () => {
    const { manageUsers, roles, auditEvents } = setup();
    const manyRoleIds = Array.from(
      { length: 12 },
      (_, index) => `0198aaaa-0000-7000-8000-${String(index).padStart(12, '0')}`,
    );
    for (const id of manyRoleIds) {
      roles.addRole(roleOf(id, `Role ${id}`, ['user.invite']));
      roles.grant(LEADER_ID, id);
    }

    const result = await manageUsers.changeRank(LEADER_ID, RANK.OPERATOR);

    expect(result.ok).toBe(true);
    const metadata = auditEvents[0]?.metadata;
    expect(metadata?.removedRoleCount).toBe(13);
    const stored = String(metadata?.removedRoles);
    expect(stored.length).toBeLessThanOrEqual(256);
    // Ids completos: ninguno queda cortado a la mitad.
    for (const id of stored.split(','))
      expect(id.length === 36 || id === LEADER_ROLE.id).toBe(true);
  });
});

describe('last administrator protection', () => {
  const onlyOneAdministrator = (): UserRecord[] => [
    person(ROOT_ID, RANK.ROOT, null),
    person(ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID),
    person(OTHER_ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID, 'suspended'),
    person(OPERATOR_ID, RANK.OPERATOR, ROOT_ID),
  ];

  // SENSIBLE (revisión humana): la organización nunca se queda sin una persona administradora activa.
  it.each([
    ['changeRank', (m: ManageUsers) => m.changeRank(ADMIN_ID, RANK.LEADER)],
    ['suspend', (m: ManageUsers) => m.suspend(ADMIN_ID)],
    ['deactivate', (m: ManageUsers) => m.deactivate(ADMIN_ID)],
  ])(
    '%s is refused and audited when the person is the only active administrator',
    async (_name, act) => {
      const { manageUsers, directory, auditDenial, revokeAllOfUser } = setup({
        users: onlyOneAdministrator(),
      });

      const result = await act(manageUsers);

      expect(!result.ok && result.error.code).toBe('USER.LAST_ADMINISTRATOR');
      expect(auditDenial).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'USER.LAST_ADMINISTRATOR', targetUserId: ADMIN_ID }),
      );
      expect(directory.users.get(ADMIN_ID)).toMatchObject({
        rank: RANK.ADMINISTRATOR,
        status: 'active',
      });
      expect(revokeAllOfUser).not.toHaveBeenCalled();
    },
  );

  // Se actúa sobre el segundo administrador porque no tiene subordinados (bajar de rango exige que no
  // los tenga) y el primero sigue activo.
  it.each([
    ['changeRank', (m: ManageUsers) => m.changeRank(OTHER_ADMIN_ID, RANK.LEADER)],
    ['suspend', (m: ManageUsers) => m.suspend(OTHER_ADMIN_ID)],
    ['deactivate', (m: ManageUsers) => m.deactivate(OTHER_ADMIN_ID)],
  ])('%s goes through when another administrator is active', async (_name, act) => {
    const { manageUsers } = setup();

    const result = await act(manageUsers);

    expect(result.ok).toBe(true);
  });

  it('does not count suspended administrators as a second one', async () => {
    const { manageUsers } = setup({ users: onlyOneAdministrator() });

    const result = await manageUsers.suspend(ADMIN_ID);

    expect(!result.ok && result.error.code).toBe('USER.LAST_ADMINISTRATOR');
  });

  it('never counts the Root: it is not an administrator for this rule', async () => {
    const { manageUsers, directory } = setup({ users: onlyOneAdministrator() });

    expect(await directory.countActiveByRank(RANK.ADMINISTRATOR)).toBe(1);
    const result = await manageUsers.deactivate(ADMIN_ID);
    expect(!result.ok && result.error.code).toBe('USER.LAST_ADMINISTRATOR');
  });

  it('lets the sole administrator be touched when they are already suspended', async () => {
    const users = [
      person(ROOT_ID, RANK.ROOT, null),
      person(ADMIN_ID, RANK.ADMINISTRATOR, ROOT_ID, 'suspended'),
    ];
    const { manageUsers } = setup({ users });

    const result = await manageUsers.deactivate(ADMIN_ID);

    expect(result.ok).toBe(true);
  });
});

describe('authorization is never bypassed', () => {
  // SENSIBLE (revisión humana): el motor se consulta primero y su negación impide todo efecto.
  it('stops before any write when the engine denies the action', async () => {
    const { manageUsers, require, directory, roles, notices, auditEvents } = setup();
    require.mockRejectedValueOnce(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'));

    await expect(manageUsers.changeRank(LEADER_ID, RANK.OPERATOR)).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });

    expect(rankOf(directory, LEADER_ID)).toBe(RANK.LEADER);
    expect([...(roles.assignments.get(LEADER_ID) ?? [])]).toContain(LEADER_ROLE.id);
    expect(notices).toHaveLength(0);
    expect(auditEvents).toHaveLength(0);
  });

  // SENSIBLE (revisión humana): un actor fuera de la jerarquía no cambia rangos aunque el motor lo deje pasar.
  it('refuses an actor who does not manage the target and audits the denial', async () => {
    const { manageUsers, auditDenial, directory } = setup({ actorId: OTHER_ADMIN_ID });

    const result = await manageUsers.changeRank(OPERATOR_ID, RANK.LEADER, 'Promotion');

    expect(!result.ok && result.error.code).toBe('AUTHZ.CREATION_NOT_ALLOWED');
    expect(auditDenial).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'AUTHZ.CREATION_NOT_ALLOWED' }),
    );
    expect(rankOf(directory, OPERATOR_ID)).toBe(RANK.OPERATOR);
  });

  it('keeps the Root protected', async () => {
    const { manageUsers } = setup();

    await expect(manageUsers.changeRank(ROOT_ID, RANK.LEADER)).rejects.toMatchObject({
      code: 'USER.ROOT_PROTECTED',
    });
  });
});
