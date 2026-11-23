import type { ManagedUser } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { buildHierarchy } from './build-hierarchy';

const ACTOR_ID = 'actor';

const person = (id: string, overrides: Partial<ManagedUser> = {}): ManagedUser => ({
  id,
  displayName: id,
  email: `${id}@example.com`,
  rank: 2,
  status: 'active',
  managedBy: ACTOR_ID,
  managerName: null,
  roleNames: null,
  ...overrides,
});

describe('buildHierarchy', () => {
  it('nests people under their manager and puts the actor’s reports at the top', () => {
    const admin = person('admin', { rank: 1 });
    const lead = person('lead', { rank: 2, managedBy: 'admin' });
    const operator = person('operator', { rank: 3, managedBy: 'lead' });

    const { directReports, detached } = buildHierarchy([operator, lead, admin], ACTOR_ID);

    expect(detached).toEqual([]);
    expect(directReports.map((node) => node.person.id)).toEqual(['admin']);
    expect(directReports[0]?.children[0]?.person.id).toBe('lead');
    expect(directReports[0]?.children[0]?.children[0]?.person.id).toBe('operator');
  });

  it('orders siblings by rank and then by name', () => {
    const people = [
      person('zeta', { rank: 2, displayName: 'Zeta' }),
      person('alfa', { rank: 2, displayName: 'Alfa' }),
      person('boss', { rank: 1, displayName: 'Boss' }),
    ];

    const { directReports } = buildHierarchy(people, ACTOR_ID);

    expect(directReports.map((node) => node.person.id)).toEqual(['boss', 'alfa', 'zeta']);
  });

  it('moves people whose manager is missing from the list to detached', () => {
    const orphan = person('orphan', { managedBy: 'unknown-manager' });

    const { directReports, detached } = buildHierarchy([orphan], ACTOR_ID);

    expect(directReports).toEqual([]);
    expect(detached.map((node) => node.person.id)).toEqual(['orphan']);
  });

  it('cuts a manager cycle instead of recursing forever and keeps everyone once', () => {
    const first = person('first', { managedBy: 'second' });
    const second = person('second', { managedBy: 'first' });

    const { directReports, detached } = buildHierarchy([first, second], ACTOR_ID);

    expect(directReports).toEqual([]);
    const placedIds = detached.flatMap(function collect(node): string[] {
      return [node.person.id, ...node.children.flatMap(collect)];
    });
    expect(placedIds.sort()).toEqual(['first', 'second']);
  });

  it('returns empty groups for an empty subtree', () => {
    expect(buildHierarchy([], ACTOR_ID)).toEqual({ directReports: [], detached: [] });
  });
});
