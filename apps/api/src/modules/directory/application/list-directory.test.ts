import { describe, expect, it, vi } from 'vitest';

import { DomainError, RANK, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { RequestContext } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { UserRecord, UserStatus } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { ListDirectory } from './list-directory.js';
import type { MemberAuthorizer } from './list-directory.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const ACTOR_ID = asUserId('actor-1');

function userWithStatus(status: UserStatus): UserRecord {
  return {
    id: ACTOR_ID,
    organizationId: ORGANIZATION_ID,
    rank: RANK.OPERATOR,
    status,
    email: 'actor@example.test',
    displayName: 'Actor',
    managedBy: null,
    createdBy: null,
    locale: 'es-MX',
    timezone: 'America/Mexico_City',
  };
}

function setup(options: { actorId: typeof ACTOR_ID | null; actor?: UserRecord }) {
  const directory = new InMemoryUserDirectory();
  if (options.actor !== undefined) directory.add(options.actor);
  const listSpy = vi.spyOn(directory, 'list');
  const uow: UnitOfWork = {
    run: (fn) => fn(),
    runIndependent: (fn) => fn(),
  };
  const context: RequestContext = {
    organizationId: ORGANIZATION_ID,
    actorId: options.actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt: null,
  };
  // Doble del motor: reproduce el contrato de `requireActiveMember` sin base de datos.
  const authorizer: MemberAuthorizer = {
    requireActiveMember: async () => {
      const actor = context.actorId === null ? null : await directory.findById(context.actorId);
      if (actor?.status !== 'active') {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }
      return actor;
    },
  };
  const requireSpy = vi.spyOn(authorizer, 'requireActiveMember');
  const useCase = new ListDirectory({ directory, uow, authorizer });
  return { useCase, listSpy, requireSpy };
}

describe('ListDirectory', () => {
  it('lists the directory for an active actor', async () => {
    const { useCase, listSpy, requireSpy } = setup({
      actorId: ACTOR_ID,
      actor: userWithStatus('active'),
    });

    await useCase.execute({ limit: 10 });

    expect(requireSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it.each<UserStatus>(['invited', 'suspended', 'deactivated'])(
    'refuses an actor whose status is %s and never reads the directory',
    async (status) => {
      const { useCase, listSpy } = setup({ actorId: ACTOR_ID, actor: userWithStatus(status) });

      await expect(useCase.execute({ limit: 10 })).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
      expect(listSpy).not.toHaveBeenCalled();
    },
  );

  it('refuses a request without an authenticated actor', async () => {
    const { useCase, listSpy } = setup({ actorId: null });

    await expect(useCase.execute({ limit: 10 })).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('refuses an actor that no longer exists', async () => {
    const { useCase, listSpy } = setup({ actorId: ACTOR_ID });

    await expect(useCase.execute({ limit: 10 })).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(listSpy).not.toHaveBeenCalled();
  });
});
