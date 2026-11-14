import type { DirectoryUser, RootTransfer } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  canAccept,
  canPropose,
  eligibleTargets,
  personName,
  rootTransferViewer,
} from './root-transfer-model';

const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const LEADER_ID = '44444444-4444-4444-8444-444444444444';

const person = (id: string, displayName: string, rank: DirectoryUser['rank']): DirectoryUser => ({
  id,
  displayName,
  email: `${displayName.toLowerCase()}@example.com`,
  rank,
});

const transfer = (overrides: Partial<RootTransfer> = {}): RootTransfer => ({
  id: '55555555-5555-4555-8555-555555555555',
  fromUserId: ROOT_ID,
  toUserId: ADMIN_ID,
  status: 'pending_acceptance',
  requestedAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-08T10:00:00.000Z',
  acceptedAt: null,
  executesAt: null,
  ...overrides,
});

describe('rootTransferViewer', () => {
  it('recognizes the Root by rank, with or without an open transfer', () => {
    expect(rootTransferViewer(0, ROOT_ID, null)).toBe('root');
    expect(rootTransferViewer(0, ROOT_ID, transfer())).toBe('root');
  });

  it('recognizes the recipient by id even though they are an Administrator', () => {
    expect(rootTransferViewer(1, ADMIN_ID, transfer())).toBe('recipient');
  });

  it('treats any other Administrator as a plain administrator', () => {
    expect(rootTransferViewer(1, OTHER_ADMIN_ID, transfer())).toBe('administrator');
    expect(rootTransferViewer(1, ADMIN_ID, null)).toBe('administrator');
  });
});

describe('canPropose', () => {
  it('lets only the Root propose, and only when nothing is open', () => {
    expect(canPropose('root', null)).toBe(true);
    expect(canPropose('root', transfer())).toBe(false);
    expect(canPropose('administrator', null)).toBe(false);
    expect(canPropose('recipient', null)).toBe(false);
  });
});

describe('canAccept', () => {
  it('lets only the recipient accept, and only while the proposal awaits an answer', () => {
    expect(canAccept('recipient', transfer())).toBe(true);
    expect(canAccept('recipient', transfer({ status: 'waiting' }))).toBe(false);
    expect(canAccept('root', transfer())).toBe(false);
    expect(canAccept('administrator', transfer())).toBe(false);
  });
});

describe('eligibleTargets', () => {
  const people = [
    person(ROOT_ID, 'Raul', 0),
    person(ADMIN_ID, 'Ana', 1),
    person(OTHER_ADMIN_ID, 'Beto', 1),
    person(LEADER_ID, 'Lola', 2),
  ];

  it('offers only Administrators and never the proposer', () => {
    expect(eligibleTargets(people, ROOT_ID).map((candidate) => candidate.id)).toEqual([
      ADMIN_ID,
      OTHER_ADMIN_ID,
    ]);
  });

  it('leaves out the caller even when they are an Administrator', () => {
    expect(eligibleTargets(people, ADMIN_ID).map((candidate) => candidate.id)).toEqual([
      OTHER_ADMIN_ID,
    ]);
  });

  it('returns nothing when there are no Administrators', () => {
    expect(eligibleTargets([person(ROOT_ID, 'Raul', 0)], ROOT_ID)).toEqual([]);
  });
});

describe('personName', () => {
  it('finds a person by id and returns undefined when it is not in the directory', () => {
    const people = [person(ADMIN_ID, 'Ana', 1)];
    expect(personName(people, ADMIN_ID)).toBe('Ana');
    expect(personName(people, LEADER_ID)).toBeUndefined();
  });
});
