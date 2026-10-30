import { TOTP_CONFIRM_MAX_FAILURES } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  INITIAL_TOTP_CONFIRM_LOCK_STATE,
  afterFailure,
  isLocked,
  lockDurationMs,
} from './totp-confirm-lock.js';
import type { TotpConfirmLockState } from './totp-confirm-lock.js';

const NOW = new Date('2026-03-04T16:00:00.000Z');
const MILLISECONDS_PER_MINUTE = 60 * 1000;

const failTimes = (state: TotpConfirmLockState, times: number, now: Date): TotpConfirmLockState => {
  let result = state;
  for (let attempt = 0; attempt < times; attempt += 1) result = afterFailure(result, now);
  return result;
};

// SENSIBLE (revisión humana)
describe('TOTP confirmation lock policy', () => {
  it('lasts 5, 15 and then 60 minutes, repeating the last step', () => {
    expect(lockDurationMs(1)).toBe(5 * MILLISECONDS_PER_MINUTE);
    expect(lockDurationMs(2)).toBe(15 * MILLISECONDS_PER_MINUTE);
    expect(lockDurationMs(3)).toBe(60 * MILLISECONDS_PER_MINUTE);
    expect(lockDurationMs(4)).toBe(60 * MILLISECONDS_PER_MINUTE);
    expect(lockDurationMs(50)).toBe(60 * MILLISECONDS_PER_MINUTE);
  });

  it('does not lock before the maximum failures', () => {
    const state = failTimes(INITIAL_TOTP_CONFIRM_LOCK_STATE, TOTP_CONFIRM_MAX_FAILURES - 1, NOW);

    expect(state.failures).toBe(TOTP_CONFIRM_MAX_FAILURES - 1);
    expect(state.lockCount).toBe(0);
    expect(isLocked(state, NOW)).toBe(false);
  });

  it('locks at the maximum failures, resets the failure count and raises the level', () => {
    const state = failTimes(INITIAL_TOTP_CONFIRM_LOCK_STATE, TOTP_CONFIRM_MAX_FAILURES, NOW);

    expect(state.failures).toBe(0);
    expect(state.lockCount).toBe(1);
    expect(state.lockedUntil).toEqual(new Date(NOW.getTime() + 5 * MILLISECONDS_PER_MINUTE));
    expect(isLocked(state, NOW)).toBe(true);
  });

  it('is locked until the exact end instant and free from then on', () => {
    const state = failTimes(INITIAL_TOTP_CONFIRM_LOCK_STATE, TOTP_CONFIRM_MAX_FAILURES, NOW);
    const end = state.lockedUntil as Date;

    expect(isLocked(state, new Date(end.getTime() - 1))).toBe(true);
    expect(isLocked(state, end)).toBe(false);
  });

  it('keeps the level after the lock expires and escalates on the next round', () => {
    const first = failTimes(INITIAL_TOTP_CONFIRM_LOCK_STATE, TOTP_CONFIRM_MAX_FAILURES, NOW);
    const later = new Date(NOW.getTime() + 6 * MILLISECONDS_PER_MINUTE);

    const second = failTimes(first, TOTP_CONFIRM_MAX_FAILURES, later);

    expect(second.lockCount).toBe(2);
    expect(second.lockedUntil).toEqual(new Date(later.getTime() + 15 * MILLISECONDS_PER_MINUTE));
  });
});
