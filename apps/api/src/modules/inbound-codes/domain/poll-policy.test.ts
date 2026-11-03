import { describe, expect, it } from 'vitest';

import { MILLISECONDS_PER_MINUTE } from './inbound-limits.js';
import {
  POLL_BACKOFF_CAP_MS,
  POLL_MESSAGE_WINDOW_MS,
  computeBackoffMs,
  computeWindowStart,
} from './poll-policy.js';

describe('poll policy', () => {
  describe('backoff', () => {
    it('doubles from one minute and never exceeds one hour', () => {
      expect(computeBackoffMs(1)).toBe(1 * MILLISECONDS_PER_MINUTE);
      expect(computeBackoffMs(2)).toBe(2 * MILLISECONDS_PER_MINUTE);
      expect(computeBackoffMs(3)).toBe(4 * MILLISECONDS_PER_MINUTE);
      expect(computeBackoffMs(6)).toBe(32 * MILLISECONDS_PER_MINUTE);
      expect(computeBackoffMs(7)).toBe(POLL_BACKOFF_CAP_MS);
      expect(computeBackoffMs(1_000_000)).toBe(POLL_BACKOFF_CAP_MS);
    });

    it('treats an invalid failure count as the first failure', () => {
      for (const invalid of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(computeBackoffMs(invalid)).toBe(1 * MILLISECONDS_PER_MINUTE);
      }
    });
  });

  it('computes the window start as fifteen minutes before now', () => {
    const now = new Date('2026-11-02T12:00:00.000Z');
    expect(computeWindowStart(now).getTime()).toBe(now.getTime() - POLL_MESSAGE_WINDOW_MS);
    expect(POLL_MESSAGE_WINDOW_MS).toBe(15 * MILLISECONDS_PER_MINUTE);
  });
});
