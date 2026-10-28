import type { Passkey, PendingInvitation, SessionSummary } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { ATTENTION_LIMIT, buildAttention, countInvitations, EXPIRING_SOON_MS } from './attention';

const NOW = new Date('2030-01-10T12:00:00.000Z');
const inMs = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const invitation = (overrides: Partial<PendingInvitation>): PendingInvitation => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'luis@example.com',
  rank: 3,
  createdAt: '2030-01-08T12:00:00.000Z',
  expiresAt: inMs(3 * EXPIRING_SOON_MS),
  expired: false,
  ...overrides,
});
const passkey: Passkey = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Laptop',
  createdAt: '2030-01-01T00:00:00.000Z',
  lastUsedAt: null,
};
const session = (current: boolean): SessionSummary => ({
  id: current ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444',
  createdAt: '2030-01-01T00:00:00.000Z',
  lastSeenAt: '2030-01-10T11:00:00.000Z',
  expiresAt: '2030-01-11T00:00:00.000Z',
  userAgent: null,
  ip: null,
  current,
});

describe('buildAttention', () => {
  it('returns nothing when every source is healthy', () => {
    expect(
      buildAttention({
        invitations: [invitation({})],
        passkeys: [passkey],
        sessions: [session(true)],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('orders expired invitations, expiring invitations, missing passkey and other sessions', () => {
    const items = buildAttention({
      invitations: [
        invitation({ id: 'a', email: 'soon@example.com', expiresAt: inMs(EXPIRING_SOON_MS - 1) }),
        invitation({ id: 'b', email: 'old@example.com', expired: true }),
      ],
      passkeys: [],
      sessions: [session(true), session(false)],
      now: NOW,
    });
    expect(items.map((item) => item.kind)).toEqual([
      'invitationExpired',
      'invitationExpiring',
      'noPasskey',
      'otherSessions',
    ]);
    expect(items[3]).toEqual({ kind: 'otherSessions', count: 1 });
  });

  it('does not invent a state for a source that has not loaded or is not allowed', () => {
    expect(
      buildAttention({
        invitations: undefined,
        passkeys: undefined,
        sessions: undefined,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it(`caps the list at ${String(ATTENTION_LIMIT)} items`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      invitation({ id: String(i), email: `p${String(i)}@example.com`, expired: true }),
    );
    expect(
      buildAttention({ invitations: many, passkeys: [], sessions: [], now: NOW }),
    ).toHaveLength(ATTENTION_LIMIT);
  });
});

describe('countInvitations', () => {
  it('splits pending from expired', () => {
    expect(
      countInvitations([invitation({}), invitation({ expired: true }), invitation({})]),
    ).toEqual({ pending: 2, expired: 1 });
  });
});
