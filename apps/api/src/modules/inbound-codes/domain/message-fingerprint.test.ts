import { describe, expect, it } from 'vitest';

import { decideDeduplication } from './message-fingerprint.js';

const MAX_FINGERPRINT_LENGTH = 128;

// SENSIBLE (revisión humana)
describe('message deduplication', () => {
  const knownFingerprints: ReadonlySet<string> = new Set(['a'.repeat(64)]);

  it('flags a known fingerprint as duplicate and an unknown one as new', () => {
    expect(decideDeduplication('a'.repeat(64), knownFingerprints)).toBe('duplicate');
    expect(decideDeduplication('b'.repeat(64), knownFingerprints)).toBe('new');
  });

  it('compares fingerprints exactly, without case folding', () => {
    expect(decideDeduplication('A'.repeat(64), knownFingerprints)).toBe('new');
  });

  it('rejects empty, oversized, whitespace or non-ASCII fingerprints', () => {
    const invalid = ['', 'x'.repeat(MAX_FINGERPRINT_LENGTH + 1), 'a b', 'a\n', 'а'.repeat(8)];
    for (const fingerprint of invalid) {
      expect(decideDeduplication(fingerprint, knownFingerprints)).toBe('invalid_fingerprint');
    }
    expect(decideDeduplication('x'.repeat(MAX_FINGERPRINT_LENGTH), knownFingerprints)).toBe('new');
  });
});
