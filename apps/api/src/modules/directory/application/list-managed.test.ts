import type { Permission } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DomainError, RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { ListManaged } from './list-managed.js';
import type { ManagedViewAuthorizer } from './list-managed.js';
import type { AssignedRoleNamesReader } from './ports/assigned-role-names-reader.js';
import type { ManagedRow } from './ports/user-directory.js';

const ACTOR_ID = asUserId('actor-1');
const LOWER_ID = asUserId('user-lower');
const NO_ROLES_ID = asUserId('user-no-roles');
const PEER_ID = asUserId('user-peer');

function actorWithRank(rank: Rank): UserRecord {
  return {
    id: ACTOR_ID,
    organizationId: asOrganizationId('org-1'),
    rank,
    status: 'active',
    email: 'actor@example.test',
    displayName: 'Actor',
    managedBy: null,
    createdBy: null,
    locale: 'es-MX',
    timezone: 'America/Mexico_City',
  };
}

const managedRow = (id: UserId, rank: Rank): ManagedRow => ({
  id,
  displayName: `Persona ${id}`,
  email: `${id}@example.test`,
  rank,
  status: 'active',
  managedBy: ACTOR_ID,
  managerName: 'Actor',
});

function setup(options: {
  actorRank?: Rank;
  permissions?: Permission[];
  rows?: ManagedRow[];
  requireActiveMember?: ManagedViewAuthorizer['requireActiveMember'];
}) {
  const { actorRank = RANK.LEADER, permissions = [], rows = [] } = options;
  const directory = new InMemoryUserDirectory();
  const listManagedSpy = vi
    .spyOn(directory, 'listManaged')
    .mockResolvedValue({ rows, nextCursor: null });
  const uow: UnitOfWork = { run: (fn) => fn(), runIndependent: (fn) => fn() };
  const authorizer: ManagedViewAuthorizer = {
    requireActiveMember:
      options.requireActiveMember ?? vi.fn(() => Promise.resolve(actorWithRank(actorRank))),
    actorPermissions: vi.fn(() => Promise.resolve(new Set(permissions))),
  };
  const listLiveRoleNames = vi.fn((ids: readonly UserId[]) =>
    Promise.resolve(
      new Map<UserId, readonly string[]>(
        ids.map((id) => [id, id === NO_ROLES_ID ? [] : [`Rol de ${id}`]]),
      ),
    ),
  );
  const roleNames: AssignedRoleNamesReader = { listLiveRoleNames };
  const useCase = new ListManaged({ directory, uow, authorizer, roleNames });
  return { useCase, listManagedSpy, listLiveRoleNames, authorizer };
}

describe('ListManaged', () => {
  it('scopes the query to the actor returned by the authorization engine', async () => {
    const requireActiveMember = vi.fn(() => Promise.resolve(actorWithRank(RANK.LEADER)));
    const { useCase, listManagedSpy } = setup({ requireActiveMember });

    await useCase.execute({ limit: 10 });

    expect(requireActiveMember).toHaveBeenCalledTimes(1);
    expect(listManagedSpy).toHaveBeenCalledWith(
      { id: ACTOR_ID, isRoot: false },
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('marks the scope as root only for the root rank', async () => {
    const { useCase, listManagedSpy } = setup({ actorRank: RANK.ROOT });

    await useCase.execute({ limit: 10 });

    expect(listManagedSpy).toHaveBeenCalledWith(
      { id: ACTOR_ID, isRoot: true },
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('never reads the managed view when the engine denies the actor', async () => {
    const requireActiveMember = vi.fn(() =>
      Promise.reject(new DomainError('AUTHZ.SESSION', 'Authenticated session required')),
    );
    const { useCase, listManagedSpy, listLiveRoleNames } = setup({ requireActiveMember });

    await expect(useCase.execute({ limit: 10 })).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(listManagedSpy).not.toHaveBeenCalled();
    expect(listLiveRoleNames).not.toHaveBeenCalled();
  });
});

// SENSIBLE (revisión humana): ver roles en la lista sigue la regla de `ManagePersonRoles.view`.
describe('ListManaged: role names', () => {
  it('includes the roles of the people the actor manages when the actor has user.invite', async () => {
    const { useCase, listLiveRoleNames } = setup({
      actorRank: RANK.LEADER,
      permissions: ['user.invite'],
      rows: [managedRow(LOWER_ID, RANK.OPERATOR), managedRow(NO_ROLES_ID, RANK.OPERATOR)],
    });

    const page = await useCase.execute({ limit: 10 });

    expect(page.rows.map((row) => row.roleNames)).toEqual([[`Rol de ${LOWER_ID}`], []]);
    // Una sola lectura por página, con el lote completo.
    expect(listLiveRoleNames).toHaveBeenCalledTimes(1);
    expect(listLiveRoleNames).toHaveBeenCalledWith([LOWER_ID, NO_ROLES_ID]);
  });

  it('returns null roles and never reads them without user.invite', async () => {
    const { useCase, listLiveRoleNames } = setup({
      actorRank: RANK.LEADER,
      permissions: ['user.update', 'role.assign'],
      rows: [managedRow(LOWER_ID, RANK.OPERATOR)],
    });

    const page = await useCase.execute({ limit: 10 });

    expect(page.rows[0]?.roleNames).toBeNull();
    expect(listLiveRoleNames).not.toHaveBeenCalled();
  });

  it('hides the roles of a row the actor cannot manage, even inside the returned page', async () => {
    const { useCase, listLiveRoleNames } = setup({
      actorRank: RANK.LEADER,
      permissions: ['user.invite'],
      rows: [managedRow(LOWER_ID, RANK.OPERATOR), managedRow(PEER_ID, RANK.LEADER)],
    });

    const page = await useCase.execute({ limit: 10 });

    expect(page.rows.find((row) => row.id === PEER_ID)?.roleNames).toBeNull();
    expect(page.rows.find((row) => row.id === LOWER_ID)?.roleNames).toEqual([`Rol de ${LOWER_ID}`]);
    expect(listLiveRoleNames).toHaveBeenCalledWith([LOWER_ID]);
  });

  it('lets the Root see the roles of everybody it lists', async () => {
    const { useCase } = setup({
      actorRank: RANK.ROOT,
      permissions: ['user.invite'],
      rows: [managedRow(PEER_ID, RANK.ADMINISTRATOR), managedRow(LOWER_ID, RANK.OPERATOR)],
    });

    const page = await useCase.execute({ limit: 10 });

    expect(page.rows.map((row) => row.roleNames)).toEqual([
      [`Rol de ${PEER_ID}`],
      [`Rol de ${LOWER_ID}`],
    ]);
  });

  it('skips the read when the page is empty', async () => {
    const { useCase, listLiveRoleNames } = setup({ permissions: ['user.invite'], rows: [] });

    const page = await useCase.execute({ limit: 10 });

    expect(page.rows).toEqual([]);
    expect(listLiveRoleNames).not.toHaveBeenCalled();
  });
});
