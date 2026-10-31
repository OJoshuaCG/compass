import { describe, expect, it } from 'vitest';

import { INBOUND_ITEM_TTL_MS, MESSAGE_DATE_TOLERANCE_MS } from './inbound-limits.js';
import { computeItemExpiry, isItemExpired } from './item-validity.js';

const RECEIVED_AT = new Date('2026-10-30T12:00:00.000Z');
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const TEN_MINUTES_MS = 10 * MILLISECONDS_PER_MINUTE;

function offsetFromReceived(offsetMs: number): Date {
  return new Date(RECEIVED_AT.getTime() + offsetMs);
}

// SENSIBLE (revisión humana)
describe('inbound item validity', () => {
  it('keeps the TTL at 10 minutes', () => {
    expect(INBOUND_ITEM_TTL_MS).toBe(TEN_MINUTES_MS);
  });

  it('counts from reception when the message date is not signed', () => {
    const result = computeItemExpiry(RECEIVED_AT, null);

    expect(result).toEqual({ ok: true, expiresAt: offsetFromReceived(TEN_MINUTES_MS) });
  });

  it('counts from the signed message date when it is earlier than reception and within tolerance', () => {
    const messageDate = offsetFromReceived(-2 * MILLISECONDS_PER_MINUTE);

    const result = computeItemExpiry(RECEIVED_AT, messageDate);

    expect(result).toEqual({
      ok: true,
      expiresAt: new Date(messageDate.getTime() + TEN_MINUTES_MS),
    });
  });

  it('never extends the validity with a date ahead of reception', () => {
    const messageDate = offsetFromReceived(3 * MILLISECONDS_PER_MINUTE);

    const result = computeItemExpiry(RECEIVED_AT, messageDate);

    expect(result).toEqual({ ok: true, expiresAt: offsetFromReceived(TEN_MINUTES_MS) });
  });

  it('accepts a date exactly at the tolerance and rejects one just beyond it, in both directions', () => {
    const atLimitPast = computeItemExpiry(
      RECEIVED_AT,
      offsetFromReceived(-MESSAGE_DATE_TOLERANCE_MS),
    );
    const beyondPast = computeItemExpiry(
      RECEIVED_AT,
      offsetFromReceived(-MESSAGE_DATE_TOLERANCE_MS - 1),
    );
    const atLimitFuture = computeItemExpiry(
      RECEIVED_AT,
      offsetFromReceived(MESSAGE_DATE_TOLERANCE_MS),
    );
    const beyondFuture = computeItemExpiry(
      RECEIVED_AT,
      offsetFromReceived(MESSAGE_DATE_TOLERANCE_MS + 1),
    );

    expect(atLimitPast.ok).toBe(true);
    expect(atLimitFuture.ok).toBe(true);
    expect(beyondPast).toEqual({ ok: false, reason: 'MESSAGE_DATE_OUT_OF_TOLERANCE' });
    expect(beyondFuture).toEqual({ ok: false, reason: 'MESSAGE_DATE_OUT_OF_TOLERANCE' });
  });

  it('rejects a replayed old signed message and invalid dates', () => {
    const replayed = computeItemExpiry(
      RECEIVED_AT,
      offsetFromReceived(-24 * 60 * MILLISECONDS_PER_MINUTE),
    );
    const invalidMessageDate = computeItemExpiry(RECEIVED_AT, new Date('not a date'));
    const invalidReception = computeItemExpiry(new Date('not a date'), null);

    expect(replayed.ok).toBe(false);
    expect(invalidMessageDate.ok).toBe(false);
    expect(invalidReception.ok).toBe(false);
  });

  it('treats an item as expired at the exact expiry instant and afterwards, never before', () => {
    const expiresAt = offsetFromReceived(TEN_MINUTES_MS);

    expect(isItemExpired(expiresAt, offsetFromReceived(TEN_MINUTES_MS - 1))).toBe(false);
    expect(isItemExpired(expiresAt, expiresAt)).toBe(true);
    expect(isItemExpired(expiresAt, offsetFromReceived(TEN_MINUTES_MS + 1))).toBe(true);
  });

  it('treats an invalid expiry date as expired (fails closed)', () => {
    expect(isItemExpired(new Date('not a date'), RECEIVED_AT)).toBe(true);
  });
});
