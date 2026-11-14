import type { DirectoryUser, GroupMember } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { memberCandidates, toCreateGroupRequest } from './groups-model';

const person = (id: string, displayName: string, rank: DirectoryUser['rank']): DirectoryUser => ({
  id,
  displayName,
  email: `${displayName.toLowerCase().replace(' ', '.')}@example.com`,
  rank,
});

const ADMIN = person('11111111-1111-4111-8111-111111111111', 'Marta Admin', 1);
const LEADER = person('22222222-2222-4222-8222-222222222222', 'Luis Líder', 2);
const OPERATOR = person('33333333-3333-4333-8333-333333333333', 'Olga Operadora', 3);

const memberOf = (user: DirectoryUser): GroupMember => ({
  userId: user.id,
  displayName: user.displayName,
  role: 'member',
  addedAt: '2026-11-01T10:00:00.000Z',
});

describe('toCreateGroupRequest', () => {
  it('sends the name and the description when both are given', () => {
    expect(toCreateGroupRequest({ name: 'Contabilidad', description: 'Finanzas' })).toEqual({
      name: 'Contabilidad',
      description: 'Finanzas',
    });
  });

  it.each([
    { label: 'empty', description: '' },
    { label: 'blank', description: '   ' },
    { label: 'null', description: null },
    { label: 'missing', description: undefined },
  ])('omits the description when it is $label', ({ description }) => {
    expect(toCreateGroupRequest({ name: 'Contabilidad', description })).toEqual({
      name: 'Contabilidad',
    });
  });

  it('trims the description it sends', () => {
    expect(toCreateGroupRequest({ name: 'Contabilidad', description: '  Finanzas  ' })).toEqual({
      name: 'Contabilidad',
      description: 'Finanzas',
    });
  });
});

describe('memberCandidates', () => {
  const people = [ADMIN, LEADER, OPERATOR];

  it('offers everyone who is not yet a member when the role is member', () => {
    expect(memberCandidates(people, [memberOf(LEADER)], 'member')).toEqual([ADMIN, OPERATOR]);
  });

  it('offers only Leaders or higher when the role is manager', () => {
    expect(memberCandidates(people, [], 'manager')).toEqual([ADMIN, LEADER]);
  });

  it('keeps excluding current members when the role is manager', () => {
    expect(memberCandidates(people, [memberOf(ADMIN)], 'manager')).toEqual([LEADER]);
  });

  it('returns nothing when everyone already belongs', () => {
    expect(memberCandidates(people, people.map(memberOf), 'member')).toEqual([]);
  });
});
