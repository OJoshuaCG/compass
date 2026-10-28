import { describe, expect, it } from 'vitest';

import {
  DomainError,
  RANK,
  asOrganizationId,
  asUserId,
  err,
  ok,
} from '../../../shared/kernel/index.js';
import type { RequestContext } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserRecord, UserStatus } from '../../directory/index.js';
import { InMemoryUserDirectory } from '../../directory/testing/in-memory-user-directory.js';
import { InMemoryRoleRepository } from '../testing/in-memory-role-repository.js';
import { Authorizer } from './authorizer.js';
import { DENIAL_GROUPING_WINDOW_MS, DenialGrouper } from './denial-grouper.js';

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
  const control = { nowMs: Date.parse('2026-10-28T12:00:00Z'), auditFails: false };
  const audit = {
    record: (input: Parameters<AuditLog['record']>[0]) => {
      if (control.auditFails) {
        return Promise.resolve(err(new DomainError('AUDIT.LOCK_TIMEOUT', 'Audit lock timeout')));
      }
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
  const clock = { now: () => new Date(control.nowMs) };
  const authorizer = new Authorizer({
    context: { current: () => context },
    directory,
    roles: new InMemoryRoleRepository(),
    audit,
    clock,
    denialGrouper: new DenialGrouper(clock),
    independently: (fn) => {
      counters.independentRuns += 1;
      return fn();
    },
  });
  return { authorizer, recorded, counters, control };
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

  it('still denies every repeated attempt but audits only the first one in the window', async () => {
    const { authorizer, recorded } = setup({ actorId: ACTOR_ID, actor: actorWith('suspended') });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(authorizer.requireActiveMember()).rejects.toMatchObject({
        code: 'AUTHZ.SESSION',
      });
    }

    expect(recorded).toHaveLength(1);
  });

  it('keeps trying to audit while the audit write fails, instead of opening the window', async () => {
    const { authorizer, recorded, control } = setup({
      actorId: ACTOR_ID,
      actor: actorWith('suspended'),
    });

    control.auditFails = true;
    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    control.auditFails = false;
    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });

    expect(recorded).toHaveLength(1);
  });

  it('audits again after the window and carries the number of grouped repeats', async () => {
    const { authorizer, recorded, control } = setup({
      actorId: ACTOR_ID,
      actor: actorWith('suspended'),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(authorizer.requireActiveMember()).rejects.toMatchObject({
        code: 'AUTHZ.SESSION',
      });
    }
    control.nowMs += DENIAL_GROUPING_WINDOW_MS;
    await expect(authorizer.requireActiveMember()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.metadata).not.toHaveProperty('suppressedCount');
    expect(recorded[1]?.metadata).toMatchObject({ suppressedCount: 3 });
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
