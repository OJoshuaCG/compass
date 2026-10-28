import { describe, expect, it } from 'vitest';

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  isBitPart,
  isPlainTextPart,
  isTimestampTextPart,
  isUuidPart,
  toKeysetPage,
} from './keyset-page.js';

const UUID = '0198cccc-0000-7000-8000-000000000001';

describe('keyset cursor', () => {
  it('round-trips the parts of the order key', () => {
    const cursor = encodeKeysetCursor(['2030-01-01 10:00:00.123456+00', UUID]);
    expect(decodeKeysetCursor(cursor, [isTimestampTextPart, isUuidPart])).toEqual([
      '2030-01-01 10:00:00.123456+00',
      UUID,
    ]);
  });

  it('treats no cursor as the first page', () => {
    expect(decodeKeysetCursor(null, [isUuidPart])).toBeNull();
  });

  it.each([
    ['not base64 json', 'not-base64-at-all!!!'],
    ['an object instead of a tuple', Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')],
    ['too few parts', encodeKeysetCursor([UUID])],
    ['too many parts', encodeKeysetCursor([UUID, UUID, UUID])],
    ['a part that fails its validator', encodeKeysetCursor(['yesterday', UUID])],
  ])('rejects %s', (_label, cursor) => {
    expect(decodeKeysetCursor(cursor, [isTimestampTextPart, isUuidPart])).toBeNull();
  });

  it('rejects non-string parts', () => {
    const cursor = Buffer.from(JSON.stringify([1, UUID])).toString('base64url');
    expect(decodeKeysetCursor(cursor, [isPlainTextPart, isUuidPart])).toBeNull();
  });
});

describe('part validators', () => {
  it('accepts only canonical uuids', () => {
    expect(isUuidPart(UUID)).toBe(true);
    expect(isUuidPart('-'.repeat(36))).toBe(false);
    expect(isUuidPart(`${UUID}; drop table users`)).toBe(false);
  });

  it('accepts postgres timestamptz text with or without fractional seconds', () => {
    expect(isTimestampTextPart('2030-01-01 10:00:00+00')).toBe(true);
    expect(isTimestampTextPart('2030-01-01 10:00:00.5-06')).toBe(true);
    expect(isTimestampTextPart('2030-01-01T10:00:00Z')).toBe(false);
    expect(isTimestampTextPart('now()')).toBe(false);
  });

  it('accepts only 0 and 1 as bit parts', () => {
    expect(isBitPart('0')).toBe(true);
    expect(isBitPart('1')).toBe(true);
    expect(isBitPart('2')).toBe(false);
    expect(isBitPart('')).toBe(false);
  });

  it('rejects control characters and oversized text', () => {
    expect(isPlainTextPart('Soporte')).toBe(true);
    expect(isPlainTextPart('ab\u0000cd')).toBe(false);
    expect(isPlainTextPart('ab\u007fcd')).toBe(false);
    expect(isPlainTextPart('x'.repeat(301))).toBe(false);
  });
});

describe('toKeysetPage', () => {
  const partsOf = (row: { id: string }): string[] => [row.id];

  it('offers no next cursor when the last page is not full', () => {
    const page = toKeysetPage([{ id: 'a' }, { id: 'b' }], 3, partsOf);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('offers no next cursor when the page is exactly full and nothing remains', () => {
    const page = toKeysetPage([{ id: 'a' }, { id: 'b' }], 2, partsOf);
    expect(page.nextCursor).toBeNull();
  });

  it('trims the extra row and builds the cursor from the last delivered one', () => {
    const page = toKeysetPage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, partsOf);
    expect(page.rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe(encodeKeysetCursor(['b']));
  });

  it('handles an empty result', () => {
    expect(toKeysetPage([], 10, partsOf)).toEqual({ rows: [], nextCursor: null });
  });
});
