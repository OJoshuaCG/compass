import { describe, expect, it, vi } from 'vitest';

import { DomainError, RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { ListManaged } from './list-managed.js';
import type { MemberAuthorizer } from './list-directory.js';

const ACTOR_ID = asUserId('actor-1');

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

function setup(authorizer: MemberAuthorizer) {
  const directory = new InMemoryUserDirectory();
  const listManagedSpy = vi.spyOn(directory, 'listManaged');
  const uow: UnitOfWork = { run: (fn) => fn(), runIndependent: (fn) => fn() };
  const useCase = new ListManaged({ directory, uow, authorizer });
  return { useCase, listManagedSpy };
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
    const requireActiveMember = vi.fn(() => Promise.resolve(actorWithRank(RANK.ROOT)));
    const { useCase, listManagedSpy } = setup({ requireActiveMember });

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
    const { useCase, listManagedSpy } = setup({ requireActiveMember });

    await expect(useCase.execute({ limit: 10 })).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(listManagedSpy).not.toHaveBeenCalled();
  });
});
