import { describe, expect, it } from 'vitest';

import { decodeHistoryCursor, encodeHistoryCursor } from './history-cursor.js';

const ID = '0198aaaa-0000-7000-8000-000000000001';

describe('history cursor', () => {
  it('round-trips a moment and an id', () => {
    const receivedAt = new Date('2026-03-04T16:00:00.123Z');

    const decoded = decodeHistoryCursor(encodeHistoryCursor({ receivedAt, id: ID }));

    expect(decoded?.receivedAt.toISOString()).toBe('2026-03-04T16:00:00.123Z');
    expect(decoded?.id).toBe(ID);
  });

  it.each([
    '',
    'no-es-un-cursor',
    'x'.repeat(200),
    Buffer.from(`2026-02-31T00:00:00.000Z|${ID}`).toString('base64url'),
    Buffer.from(`2026-03-04T16:00:00.000Z|no-es-uuid`).toString('base64url'),
    Buffer.from(`2026-03-04T16:00:00.000Z|${ID}|extra`).toString('base64url'),
    Buffer.from(`2026-03-04 16:00:00|${ID}`).toString('base64url'),
  ])('rejects a malformed cursor: %j', (encoded) => {
    expect(decodeHistoryCursor(encoded)).toBeNull();
  });
});
