import { describe, expect, it } from 'vitest';

import { LogPollObserver } from './log-poll-observer.js';

describe('LogPollObserver', () => {
  it('writes one closed-schema JSON line with opaque ids and bounded verdicts only', () => {
    const lines: string[] = [];
    const observer = new LogPollObserver((line) => lines.push(line));

    observer.messageHandled({
      sourceId: 'source-1',
      fingerprint: 'abc123',
      outcome: 'quarantined',
      reason: 'NO_VALID_SIGNATURE',
      verdicts: { spf: 'pass', dkim: 'none', dmarc: null },
      signature: null,
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      event: 'inbound.message',
      sourceId: 'source-1',
      fingerprint: 'abc123',
      outcome: 'quarantined',
      reason: 'NO_VALID_SIGNATURE',
      spf: 'pass',
      dkim: 'none',
      dmarc: null,
      signingDomain: null,
      selector: null,
      aligned: null,
      bodyLengthLimit: null,
      signedHeaders: null,
    });
  });

  it('writes null verdicts when the message was not assessed', () => {
    const lines: string[] = [];
    new LogPollObserver((line) => lines.push(line)).messageHandled({
      sourceId: 'source-1',
      fingerprint: null,
      outcome: 'skipped_by_prefilter',
      reason: null,
      verdicts: null,
      signature: null,
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ spf: null, dkim: null, dmarc: null });
  });

  it('writes the signing domain, selector, alignment, body-length limit and signed headers of the signature', () => {
    const lines: string[] = [];
    new LogPollObserver((line) => lines.push(line)).messageHandled({
      sourceId: 'source-1',
      fingerprint: 'abc123',
      outcome: 'accepted',
      reason: null,
      verdicts: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      signature: {
        signingDomain: 'Facebook.com',
        selector: 's1',
        hasBodyLengthLimit: true,
        signedHeaderCounts: { from: 2, to: 1, subject: 2, date: 1 },
      },
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      signingDomain: 'facebook.com',
      selector: 's1',
      aligned: true,
      bodyLengthLimit: true,
      signedHeaders: { from: 2, to: 1, subject: 2, date: 1 },
    });
  });

  it('drops a domain or selector that does not look like a DNS name instead of copying it into the line', () => {
    const lines: string[] = [];
    new LogPollObserver((line) => lines.push(line)).messageHandled({
      sourceId: 'source-1',
      fingerprint: 'abc123',
      outcome: 'accepted',
      reason: null,
      verdicts: null,
      signature: {
        signingDomain: 'x.example"}\n{"event":"forged',
        selector: 'a'.repeat(300),
        hasBodyLengthLimit: false,
        signedHeaderCounts: { from: 1, to: 1, subject: 1, date: 1 },
      },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('forged');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ signingDomain: null, selector: null });
  });
});
