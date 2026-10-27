import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { INVITATION_TTL_MS, invitationExpiry, isInvitationLive } from './invitation-policy.js';
import { evaluatePassword, personalTokens } from './password-policy.js';
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_RANDOM_BYTES,
} from './recovery-codes.js';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  absoluteExpiry,
  checkSession,
} from './session-policy.js';
import { THROTTLE_WINDOW_MS, throttleStatus } from './throttle-policy.js';
import { toBase64Url } from './tokens.js';

const T0 = new Date('2026-06-01T12:00:00.000Z');
const after = (ms: number): Date => new Date(T0.getTime() + ms);

describe('password policy', () => {
  const ok = { score: 4, personalTokens: [] as string[] };

  it('accepts a long, strong password with no composition rules', () => {
    expect(evaluatePassword({ password: 'correct horse battery staple', ...ok })).toBeNull();
    expect(evaluatePassword({ password: 'todo en minusculas sin numeros', ...ok })).toBeNull();
  });

  it('requires at least 12 characters and counts code points, not UTF-16 units', () => {
    expect(evaluatePassword({ password: 'abcdefghijk', ...ok })).toBe('TOO_SHORT');
    expect(evaluatePassword({ password: 'abcdefghijkl', ...ok })).toBeNull();
    // 11 emojis = 22 unidades UTF-16 pero solo 11 caracteres.
    expect(evaluatePassword({ password: '😀'.repeat(11), ...ok })).toBe('TOO_SHORT');
  });

  it('caps the length to keep hashing cost bounded', () => {
    expect(evaluatePassword({ password: 'a'.repeat(1025), ...ok })).toBe('TOO_LONG');
  });

  it('rejects a weak password even when it is long enough', () => {
    expect(evaluatePassword({ password: 'password1234', score: 1, personalTokens: [] })).toBe(
      'TOO_WEAK',
    );
    expect(evaluatePassword({ password: 'password1234', score: 2, personalTokens: [] })).toBe(
      'TOO_WEAK',
    );
    expect(
      evaluatePassword({ password: 'a-fine-passphrase', score: 3, personalTokens: [] }),
    ).toBeNull();
  });

  it('rejects a password containing personal data, in any letter case', () => {
    const tokens = personalTokens('maria.lopez@acme.test', 'María López');
    expect(
      evaluatePassword({ password: 'MariaLopez-2026-x', score: 4, personalTokens: tokens }),
    ).toBe('CONTAINS_PERSONAL_DATA');
    expect(
      evaluatePassword({ password: 'my LOPEZ vault 99', score: 4, personalTokens: tokens }),
    ).toBe('CONTAINS_PERSONAL_DATA');
  });

  it('only extracts personal tokens of four or more letters', () => {
    expect(personalTokens('al@acme.test', 'Al Li')).toEqual(
      ['al@acme.test'.split('@')[0] ?? ''].filter((t) => t.length >= 4),
    );
    expect(personalTokens('joe.smith@acme.test', 'Joe Smith')).toEqual(
      expect.arrayContaining(['joe.smith', 'smith']),
    );
  });
});

describe('session policy', () => {
  const live = { now: T0, lastSeenAt: T0, expiresAt: after(SESSION_ABSOLUTE_MS), revokedAt: null };

  it('accepts a fresh session', () => {
    expect(checkSession(live)).toBeNull();
  });

  it('expires after 30 minutes of inactivity', () => {
    expect(checkSession({ ...live, now: after(SESSION_IDLE_MS - 1) })).toBeNull();
    expect(checkSession({ ...live, now: after(SESSION_IDLE_MS) })).toBe('IDLE');
  });

  it('keeps an active session alive until the absolute 12-hour limit, then expires it', () => {
    const lastSeen = after(SESSION_ABSOLUTE_MS - 1000);
    expect(
      checkSession({ ...live, now: after(SESSION_ABSOLUTE_MS - 500), lastSeenAt: lastSeen }),
    ).toBeNull();
    expect(checkSession({ ...live, now: after(SESSION_ABSOLUTE_MS), lastSeenAt: lastSeen })).toBe(
      'EXPIRED',
    );
  });

  it('a revoked session is never valid again, whatever the clocks say', () => {
    expect(checkSession({ ...live, revokedAt: T0 })).toBe('REVOKED');
  });

  it('computes the absolute expiry 12 hours after creation', () => {
    expect(absoluteExpiry(T0).getTime() - T0.getTime()).toBe(12 * 60 * 60 * 1000);
  });
});

describe('login throttle', () => {
  it('allows the first two failures with no delay', () => {
    expect(throttleStatus(0, null, T0)).toEqual({ allowed: true });
    expect(throttleStatus(2, T0, after(1))).toEqual({ allowed: true });
  });

  it('adds a growing delay from the third failure (1s, 2s, 4s, ...)', () => {
    expect(throttleStatus(3, T0, after(500))).toEqual({ allowed: false, retryAfterMs: 500 });
    expect(throttleStatus(3, T0, after(1000))).toEqual({ allowed: true });
    expect(throttleStatus(4, T0, after(1000))).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(throttleStatus(5, T0, after(1000))).toEqual({ allowed: false, retryAfterMs: 3000 });
  });

  it('locks for 15 minutes after ten failures, but never permanently', () => {
    expect(throttleStatus(10, T0, after(60_000))).toEqual({
      allowed: false,
      retryAfterMs: THROTTLE_WINDOW_MS - 60_000,
    });
    expect(throttleStatus(50, T0, after(THROTTLE_WINDOW_MS))).toEqual({ allowed: true });
  });

  it('forgets old failures after the window', () => {
    expect(throttleStatus(9, T0, after(THROTTLE_WINDOW_MS + 1))).toEqual({ allowed: true });
  });
});

describe('invitation policy', () => {
  const base = { now: T0, expiresAt: invitationExpiry(T0), acceptedAt: null, revokedAt: null };

  it('is valid for 72 hours', () => {
    expect(invitationExpiry(T0).getTime() - T0.getTime()).toBe(INVITATION_TTL_MS);
    expect(INVITATION_TTL_MS).toBe(72 * 60 * 60 * 1000);
    expect(isInvitationLive(base)).toBe(true);
    expect(isInvitationLive({ ...base, now: after(INVITATION_TTL_MS - 1) })).toBe(true);
    expect(isInvitationLive({ ...base, now: after(INVITATION_TTL_MS) })).toBe(false);
  });

  it('is single use and can be revoked', () => {
    expect(isInvitationLive({ ...base, acceptedAt: T0 })).toBe(false);
    expect(isInvitationLive({ ...base, revokedAt: T0 })).toBe(false);
  });
});

describe('tokens', () => {
  it('encodes base64url exactly like Node does, for every length', () => {
    for (let length = 0; length <= 64; length += 1) {
      const bytes = randomBytes(length);
      expect(toBase64Url(new Uint8Array(bytes))).toBe(bytes.toString('base64url'));
    }
  });

  it('uses only URL-safe characters with no padding', () => {
    expect(toBase64Url(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });
});

describe('recovery codes', () => {
  it('formats a 60-bit code as XXXX-XXXX-XXXX from an unambiguous alphabet', () => {
    const code = formatRecoveryCode(new Uint8Array(randomBytes(RECOVERY_CODE_RANDOM_BYTES)));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01OI]/);
  });

  it('never repeats across many codes (60 bits of entropy)', () => {
    const codes = new Set(
      Array.from({ length: 2000 }, () => formatRecoveryCode(new Uint8Array(randomBytes(12)))),
    );
    expect(codes.size).toBe(2000);
  });

  it('accepts a code as shown or typed loosely', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jklm')).toBe('ABCDEFGHJKLM');
    expect(normalizeRecoveryCode(' ABCD EFGH JKLM ')).toBe('ABCDEFGHJKLM');
    expect(normalizeRecoveryCode('ABCDEFGHJKLM')).toBe('ABCDEFGHJKLM');
  });
});
