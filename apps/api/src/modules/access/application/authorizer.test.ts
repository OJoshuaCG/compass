import { describe, expect, it } from 'vitest';

import { RANK, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { RequestContext } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserRecord, UserStatus } from '../../directory/index.js';
import { InMemoryUserDirectory } from '../../directory/testing/in-memory-user-directory.js';
import { InMemoryRoleRepository } from '../testing/in-memory-role-repository.js';
import { Authorizer } from './authorizer.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const OTHER_ORGANIZATION_ID = asOrganizationId('org-2');
const ACTOR_ID = asUserId('actor-1');

function actorWith(status: UserStatus, organizationId = ORGANIZATION_ID): UserRecord {
  return {
    id: ACTOR_ID,
    organizationId,
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
  const recorded: Parameters<AuditLog['record']>[0][] = [];
  const counters = { independentRuns: 0 };
  const audit = {
    record: (input: Parameters<AuditLog['record']>[0]) => {
      recorded.push(input);
      return Promise.resolve(ok({} as never));
    },
  } as unknown as AuditLog;
  const context: RequestContext = {
    organizationId: ORGANIZATION_ID,
    actorId: options.actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt: null,
  };
  const authorizer = new Authorizer({
    context: { current: () => context },
    directory,
    roles: new InMemoryRoleRepository(),
    audit,
    clock: { now: () => new Date('2026-10-28T12:00:00Z') },
    independently: (fn) => {
      counters.independentRuns += 1;
      return fn();
    },
  });
  return { authorizer, recorded, counters };
}

describe('Authorizer.requireActiveMember', () => {
  it('returns the actor when it is active and belongs to the context organization', async () => {
    const { authorizer, recorded, counters } = setup({
      actorId: ACTOR_ID,
      actor: actorWith('active'),
    });

    const actor = await authorizer.requireActiveMember();

    expect(actor.id).toBe(ACTOR_ID);
    expect(recorded).toHaveLength(0);
    expect(counters.independentRuns).toBe(0);
  });

  it.each<UserStatus>(['invited', 'suspended', 'deactivated'])(
    'denies an actor whose status is %s and audits the denial',
    async (status) => {
      const { authorizer, recorded, counters } = setup({
        actorId: ACTOR_ID,
        actor: actorWith(status),
      });

      await expect(authorizer.requireActiveMember()).rejects.toMatchObject({
        code: 'AUTHZ.SESSION',
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        action: 'authz.denied',
        actorId: ACTOR_ID,
        requestId: 'request-1',
        outcome: 'denied',
        reasonCode: 'AUTHZ.SESSION',
        metadata: { permission: 'directory.view', resourceType: 'none' },
      });
      // ADR 0022: la negación se escribe fuera de la transacción de la consulta que se revierte.
      expect(counters.independentRuns).toBe(1);
    },
  );

  it('denies a request without an actor and audits the denial', async () => {
    const { authorizer, recorded } = setup({ actorId: null });

    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(recorded).toHaveLength(1);
  });

  it('denies an actor that no longer exists and audits the denial', async () => {
    const { authorizer, recorded } = setup({ actorId: ACTOR_ID });

    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(recorded).toHaveLength(1);
  });

  it('denies with TENANT when the actor belongs to another organization', async () => {
    const { authorizer, recorded } = setup({
      actorId: ACTOR_ID,
      actor: actorWith('active', OTHER_ORGANIZATION_ID),
    });

    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.TENANT' });
    expect(recorded[0]).toMatchObject({ reasonCode: 'AUTHZ.TENANT' });
  });
});
