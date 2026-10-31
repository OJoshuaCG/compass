import { describe, expect, it } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import {
  canChangeRank,
  canCreateRank,
  canManage,
  canTransferManager,
  isRankPromotion,
  wouldLeaveNoActiveAdministrator,
} from './management-policy.js';
import type { UserStatus, UserSubject } from './user.js';

const ORG = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const OTHER_ORG = asOrganizationId('0198bbbb-0000-7000-8000-000000000002');
const RANKS: readonly Rank[] = [0, 1, 2, 3];

const subject = (id: string, rank: Rank, overrides: Partial<UserSubject> = {}): UserSubject => ({
  id: asUserId(id),
  organizationId: ORG,
  rank,
  status: 'active',
  ...overrides,
});

// ---------------------------------------------------------------------------------------------
// Matrices como DATOS, escritas a mano a partir del plan (no derivadas de la implementación).
// ---------------------------------------------------------------------------------------------

/** Quién crea a quién (fila = rango del actor, columna = rango a crear). */
const CREATION_MATRIX: Record<Rank, Record<Rank, boolean>> = {
  0: { 0: false, 1: true, 2: true, 3: true },
  1: { 0: false, 1: false, 2: true, 3: true },
  2: { 0: false, 1: false, 2: false, 3: true },
  3: { 0: false, 1: false, 2: false, 3: false },
};

/** Quién gestiona a quién: 'always' (Raíz), 'subtree' (solo su subárbol) o 'never'. */
const MANAGEMENT_MATRIX: Record<Rank, Record<Rank, 'always' | 'subtree' | 'never'>> = {
  0: { 0: 'always', 1: 'always', 2: 'always', 3: 'always' },
  1: { 0: 'never', 1: 'never', 2: 'subtree', 3: 'subtree' },
  2: { 0: 'never', 1: 'never', 2: 'never', 3: 'subtree' },
  3: { 0: 'never', 1: 'never', 2: 'never', 3: 'never' },
};

describe('creation matrix (who creates whom)', () => {
  for (const actorRank of RANKS) {
    for (const targetRank of RANKS) {
      it(`rank ${String(actorRank)} creating rank ${String(targetRank)} -> ${String(
        CREATION_MATRIX[actorRank][targetRank],
      )}`, () => {
        expect(canCreateRank(actorRank, targetRank)).toBe(CREATION_MATRIX[actorRank][targetRank]);
      });
    }
  }

  it('only the Root creates Administrators, so nobody creates someone of their own rank', () => {
    for (const rank of RANKS) expect(canCreateRank(rank, rank)).toBe(false);
    expect(canCreateRank(1, 1)).toBe(false);
  });
});

describe('management rule: every actor x target x relation combination', () => {
  const statuses: UserStatus[] = ['active', 'invited', 'suspended', 'deactivated'];

  for (const actorRank of RANKS) {
    for (const targetRank of RANKS) {
      for (const inSubtree of [true, false]) {
        for (const status of statuses) {
          for (const sameOrg of [true, false]) {
            const rule = MANAGEMENT_MATRIX[actorRank][targetRank];
            const expected =
              status === 'active' &&
              sameOrg &&
              (rule === 'always' || (rule === 'subtree' && inSubtree));

            it(`actor rank ${String(actorRank)} (${status}) -> target rank ${String(
              targetRank,
            )}, subtree=${String(inSubtree)}, sameOrg=${String(sameOrg)} -> ${String(expected)}`, () => {
              const actor = subject('0198cccc-0000-7000-8000-00000000000a', actorRank, { status });
              const target = subject('0198cccc-0000-7000-8000-00000000000b', targetRank, {
                organizationId: sameOrg ? ORG : OTHER_ORG,
              });

              expect(canManage(actor, target, inSubtree)).toBe(expected);
            });
          }
        }
      }
    }
  }

  it('nobody manages themselves, not even the Root', () => {
    for (const rank of RANKS) {
      const me = subject('0198cccc-0000-7000-8000-00000000000c', rank);
      expect(canManage(me, me, true)).toBe(false);
    }
  });
});

describe('worked example from the plan (Ana, Pedro, Luis)', () => {
  const root = subject('0198cccc-0000-7000-8000-000000000001', 0);
  const ana = subject('0198cccc-0000-7000-8000-000000000002', 1);
  const pedro = subject('0198cccc-0000-7000-8000-000000000003', 1);
  const luis = subject('0198cccc-0000-7000-8000-000000000004', 2);

  it('Ana (Administrator) created Luis (Leader): she manages him', () => {
    expect(canManage(ana, luis, true)).toBe(true);
  });

  it('Pedro (Administrator) cannot manage Luis: he is not in his subtree', () => {
    expect(canManage(pedro, luis, false)).toBe(false);
  });

  it('Ana cannot manage Pedro: same rank', () => {
    expect(canManage(ana, pedro, false)).toBe(false);
    expect(canManage(ana, pedro, true)).toBe(false);
  });

  it('the Root manages all three', () => {
    for (const person of [ana, pedro, luis]) expect(canManage(root, person, false)).toBe(true);
  });
});

describe('manager transfer (rule 4)', () => {
  const ana = subject('0198cccc-0000-7000-8000-000000000002', 1);
  const luis = subject('0198cccc-0000-7000-8000-000000000004', 2);
  const oscar = subject('0198cccc-0000-7000-8000-000000000005', 3);
  const base = {
    actor: ana,
    target: oscar,
    targetInActorSubtree: true,
    newManager: luis,
    newManagerIsActorOrInSubtree: true,
  };

  it('allows moving an Operator under a Leader of the actor subtree', () => {
    expect(canTransferManager(base)).toBe(true);
  });

  it('allows the actor to take the target directly', () => {
    expect(canTransferManager({ ...base, newManager: ana })).toBe(true);
  });

  it('refuses a new manager outside the actor subtree', () => {
    expect(canTransferManager({ ...base, newManagerIsActorOrInSubtree: false })).toBe(false);
  });

  it('refuses a new manager of equal or lower authority than the target', () => {
    expect(
      canTransferManager({
        ...base,
        newManager: subject('0198cccc-0000-7000-8000-000000000006', 3),
      }),
    ).toBe(false);
    expect(canTransferManager({ ...base, target: luis, newManager: luis })).toBe(false);
  });

  it('refuses when the actor does not manage the target', () => {
    expect(canTransferManager({ ...base, targetInActorSubtree: false })).toBe(false);
  });

  it('refuses an inactive or foreign new manager', () => {
    expect(canTransferManager({ ...base, newManager: { ...luis, status: 'suspended' } })).toBe(
      false,
    );
    expect(
      canTransferManager({ ...base, newManager: { ...luis, organizationId: OTHER_ORG } }),
    ).toBe(false);
  });
});

describe('rank change (rule 5)', () => {
  const ana = subject('0198cccc-0000-7000-8000-000000000002', 1);
  const luis = subject('0198cccc-0000-7000-8000-000000000004', 2);
  const base = {
    actor: ana,
    target: luis,
    targetInActorSubtree: true,
    newRank: 3 as Rank,
    targetHasReports: false,
  };

  it('allows demoting a Leader without reports to Operator', () => {
    expect(canChangeRank(base)).toBe(true);
  });

  it('blocks demoting someone who still has reports until they are reassigned', () => {
    expect(canChangeRank({ ...base, targetHasReports: true })).toBe(false);
  });

  it('allows promoting a person with reports (promotion does not orphan anyone)', () => {
    expect(
      canChangeRank({
        ...base,
        target: subject('0198cccc-0000-7000-8000-000000000007', 3),
        newRank: 2,
        targetHasReports: false,
      }),
    ).toBe(true);
  });

  it('refuses a new rank the actor could not create (no promotion to its own rank or above)', () => {
    expect(canChangeRank({ ...base, newRank: 1 })).toBe(false);
    expect(canChangeRank({ ...base, newRank: 0 })).toBe(false);
  });

  it('refuses when the actor does not manage the target', () => {
    expect(canChangeRank({ ...base, targetInActorSubtree: false })).toBe(false);
  });
});

describe('rank promotion', () => {
  it.each(RANKS.flatMap((from) => RANKS.map((to) => [from, to] as const)))(
    'from %i to %i is a promotion only when the number goes down',
    (from, to) => {
      expect(isRankPromotion(from, to)).toBe(to < from);
    },
  );
});

describe('last active administrator', () => {
  const STATUSES: readonly UserStatus[] = ['active', 'suspended', 'invited', 'deactivated'];

  // SENSIBLE (revisión humana): matriz escrita a mano de cuándo se bloquea la acción.
  it('blocks leaving rank 1 or suspending/deactivating when they are the only active one', () => {
    const sole = subject('admin', 1);
    for (const newRank of [null, 0, 2, 3] as const) {
      expect(
        wouldLeaveNoActiveAdministrator({ target: sole, newRank, activeAdministratorCount: 1 }),
      ).toBe(true);
    }
  });

  it('allows the action when another active administrator remains', () => {
    expect(
      wouldLeaveNoActiveAdministrator({
        target: subject('admin', 1),
        newRank: 2,
        activeAdministratorCount: 2,
      }),
    ).toBe(false);
  });

  it('never blocks an action that keeps the person as administrator', () => {
    expect(
      wouldLeaveNoActiveAdministrator({
        target: subject('admin', 1),
        newRank: 1,
        activeAdministratorCount: 1,
      }),
    ).toBe(false);
  });

  it.each(STATUSES.filter((status) => status !== 'active'))(
    'does not protect a %s administrator: they were not counted',
    (status) => {
      expect(
        wouldLeaveNoActiveAdministrator({
          target: subject('admin', 1, { status }),
          newRank: null,
          activeAdministratorCount: 1,
        }),
      ).toBe(false);
    },
  );

  it.each([0, 2, 3] as const)('does not protect rank %i', (rank) => {
    expect(
      wouldLeaveNoActiveAdministrator({
        target: subject('person', rank),
        newRank: null,
        activeAdministratorCount: 1,
      }),
    ).toBe(false);
  });
});
