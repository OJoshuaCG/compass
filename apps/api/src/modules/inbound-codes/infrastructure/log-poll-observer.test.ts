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
    });

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ spf: null, dkim: null, dmarc: null });
  });
});
