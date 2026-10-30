import type { ManagedUser, Permission } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  assignableRanks,
  availableActions,
  canManageTeam,
  isRankPromotion,
  managerCandidates,
} from './team-actions';

const person = (overrides: Partial<ManagedUser> = {}): ManagedUser => ({
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Luis',
  email: 'luis@example.com',
  rank: 3,
  status: 'active',
  managedBy: null,
  ...overrides,
});

const ALL: Permission[] = ['user.deactivate', 'user.update', 'user.change_rank', 'user.transfer'];

describe('canManageTeam', () => {
  it('needs at least one management permission', () => {
    expect(canManageTeam([])).toBe(false);
    expect(canManageTeam(['user.invite', 'vault.inventory.read'])).toBe(false);
    for (const permission of ALL) expect(canManageTeam([permission])).toBe(true);
  });
});

describe('assignableRanks', () => {
  it('offers only lower-authority ranks different from the current one', () => {
    expect(assignableRanks(0, 3)).toEqual([1, 2]);
    expect(assignableRanks(1, 3)).toEqual([2]);
    expect(assignableRanks(1, 2)).toEqual([3]);
    expect(assignableRanks(2, 3)).toEqual([]);
  });
});

describe('managerCandidates', () => {
  it('keeps only people with a strictly lower rank number than the managed person', () => {
    const people = [
      { id: 'a', rank: 0 as const },
      { id: 'b', rank: 2 as const },
      { id: 'c', rank: 3 as const },
    ];
    expect(managerCandidates(people, { id: 'x', rank: 3 }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(managerCandidates(people, { id: 'x', rank: 2 }).map((p) => p.id)).toEqual(['a']);
    // Nunca ella misma.
    expect(managerCandidates(people, { id: 'a', rank: 3 }).map((p) => p.id)).toEqual(['b']);
  });
});

describe('availableActions', () => {
  const actor = { rank: 1 as const, permissions: ALL };

  it('offers suspend, change rank, transfer, close sessions and deactivate for an active person', () => {
    expect(availableActions(person(), actor)).toEqual([
      'suspend',
      'changeRank',
      'transfer',
      'closeSessions',
      'deactivate',
    ]);
  });

  it('offers reactivate instead of suspend for a suspended person', () => {
    expect(availableActions(person({ status: 'suspended' }), actor)).toEqual([
      'reactivate',
      'changeRank',
      'transfer',
      'closeSessions',
      'deactivate',
    ]);
  });

  it('offers close sessions only with user.deactivate', () => {
    const only = (permission: Permission) =>
      availableActions(person(), { rank: 1, permissions: [permission] });
    expect(only('user.deactivate')).toContain('closeSessions');
    for (const permission of ALL.filter((p) => p !== 'user.deactivate')) {
      expect(only(permission)).not.toContain('closeSessions');
    }
  });

  it('hides each action without its permission', () => {
    expect(availableActions(person(), { rank: 1, permissions: ['user.update'] })).toEqual([]);
    expect(availableActions(person(), { rank: 1, permissions: ['user.transfer'] })).toEqual([
      'transfer',
    ]);
    expect(
      availableActions(person({ status: 'suspended' }), { rank: 1, permissions: ['user.update'] }),
    ).toEqual(['reactivate']);
  });

  it('offers nothing for Root or for deactivated people', () => {
    expect(availableActions(person({ rank: 0 }), actor)).toEqual([]);
    expect(availableActions(person({ status: 'deactivated' }), actor)).toEqual([]);
  });

  it('hides change rank when no other rank is assignable', () => {
    expect(availableActions(person({ rank: 3 }), { rank: 2, permissions: ALL })).not.toContain(
      'changeRank',
    );
  });
});

describe('isRankPromotion', () => {
  it('is true only when the new rank has more authority (lower number)', () => {
    expect(isRankPromotion(3, 2)).toBe(true);
    expect(isRankPromotion(3, 1)).toBe(true);
    expect(isRankPromotion(1, 3)).toBe(false);
    expect(isRankPromotion(2, 2)).toBe(false);
  });
});
