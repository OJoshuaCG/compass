import { describe, expect, it } from 'vitest';

import { isValidInteractionUid } from './interaction-uid';

describe('isValidInteractionUid', () => {
  it('accepts base64url identifiers up to 128 characters', () => {
    expect(isValidInteractionUid('aB3_-xYz')).toBe(true);
    expect(isValidInteractionUid('a'.repeat(128))).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['too long', 'a'.repeat(129)],
    ['slash', 'abc/def'],
    ['dot segments', '..'],
    ['query', 'abc?x=1'],
    ['fragment', 'abc#x'],
    ['space', 'abc def'],
    ['percent', 'abc%2f'],
    ['non ascii', 'abç'],
  ])('rejects %s', (_label, value) => {
    expect(isValidInteractionUid(value)).toBe(false);
  });
});
