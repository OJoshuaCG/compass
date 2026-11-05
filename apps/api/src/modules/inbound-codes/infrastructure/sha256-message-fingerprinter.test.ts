import { describe, expect, it } from 'vitest';

import { Sha256MessageFingerprinter } from './sha256-message-fingerprinter.js';

const SOURCE_A = '0198aaaa-0000-7000-8000-000000000001';
const SOURCE_B = '0198aaaa-0000-7000-8000-000000000002';

describe('Sha256MessageFingerprinter', () => {
  const fingerprinter = new Sha256MessageFingerprinter();

  it('is stable and fits the receipt column format (printable ASCII, at most 128 characters)', () => {
    const bytes = new TextEncoder().encode('From: a@b.example\r\n\r\ncuerpo');

    const first = fingerprinter.forRawMessage(SOURCE_A, bytes);

    expect(fingerprinter.forRawMessage(SOURCE_A, bytes)).toBe(first);
    expect(first).toMatch(/^[!-~]{1,128}$/);
  });

  it('separates the same bytes received by different sources', () => {
    const bytes = new TextEncoder().encode('mismo mensaje');

    expect(fingerprinter.forRawMessage(SOURCE_A, bytes)).not.toBe(
      fingerprinter.forRawMessage(SOURCE_B, bytes),
    );
  });

  it('distinguishes messages that differ by a single byte, including non-ASCII ones', () => {
    const one = Uint8Array.from([0x61, 0xc3, 0xa9]);
    const other = Uint8Array.from([0x61, 0xc3, 0xa8]);

    expect(fingerprinter.forRawMessage(SOURCE_A, one)).not.toBe(
      fingerprinter.forRawMessage(SOURCE_A, other),
    );
  });

  it('keeps raw and mailbox-position fingerprints in separate domains', () => {
    expect(fingerprinter.forMailboxPosition(SOURCE_A, 7, 11)).not.toBe(
      fingerprinter.forRawMessage(SOURCE_A, new TextEncoder().encode('7\n11')),
    );
  });

  it('depends on every part of the mailbox position', () => {
    const base = fingerprinter.forMailboxPosition(SOURCE_A, 7, 11);

    expect(fingerprinter.forMailboxPosition(SOURCE_A, 8, 11)).not.toBe(base);
    expect(fingerprinter.forMailboxPosition(SOURCE_A, 7, 12)).not.toBe(base);
    expect(fingerprinter.forMailboxPosition(SOURCE_B, 7, 11)).not.toBe(base);
  });
});
