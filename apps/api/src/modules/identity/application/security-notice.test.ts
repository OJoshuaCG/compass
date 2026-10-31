import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserId } from '../../../shared/kernel/index.js';
import { SECURITY_NOTICE_TIMEOUT_MS, sendSecurityNotice } from './security-notice.js';
import type { SecurityNoticeDeps, SecurityNoticePlan } from './security-notice.js';

const PLAN: SecurityNoticePlan = {
  kind: 'passkey_added',
  userId: '0194f3a0-0000-7000-8000-000000000001' as UserId,
  to: 'person@x.test',
  locale: 'en-US',
  occurredAt: new Date('2026-03-04T15:30:00.000Z'),
  requestId: 'req-1',
};

interface Doubles {
  readonly deps: SecurityNoticeDeps;
  readonly sendSecurityNotice: ReturnType<typeof vi.fn>;
  readonly record: ReturnType<typeof vi.fn>;
  readonly reportLost: ReturnType<typeof vi.fn>;
}

const build = (overrides: {
  send?: () => Promise<void>;
  record?: () => Promise<void>;
}): Doubles => {
  const send = vi.fn(overrides.send ?? (() => Promise.resolve()));
  const record = vi.fn(overrides.record ?? (() => Promise.resolve()));
  const reportLost = vi.fn();
  const deps = {
    mailer: { sendSecurityNotice: send },
    uow: { run: (work: () => Promise<unknown>) => work() },
    audit: { record },
    context: { current: vi.fn() },
    reportLost,
  } as unknown as SecurityNoticeDeps;
  return { deps, sendSecurityNotice: send, record, reportLost };
};

describe('sendSecurityNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the notice and audits nothing when delivery works', async () => {
    const doubles = build({});

    await sendSecurityNotice(doubles.deps, PLAN);

    expect(doubles.sendSecurityNotice).toHaveBeenCalledOnce();
    expect(doubles.record).not.toHaveBeenCalled();
    expect(doubles.reportLost).not.toHaveBeenCalled();
  });

  it('audits only the kind when delivery fails, and never throws', async () => {
    const doubles = build({ send: () => Promise.reject(new Error('mail down')) });

    await expect(sendSecurityNotice(doubles.deps, PLAN)).resolves.toBeUndefined();

    expect(doubles.record).toHaveBeenCalledOnce();
    const event = doubles.record.mock.calls[0]?.[0] as { metadata: unknown; outcome: string };
    expect(event.outcome).toBe('failure');
    expect(event.metadata).toEqual({ kind: 'passkey_added' });
    expect(JSON.stringify(event)).not.toContain('person@x.test');
    expect(doubles.reportLost).not.toHaveBeenCalled();
  });

  it('gives up after the timeout instead of holding the response, and audits it', async () => {
    const doubles = build({ send: () => new Promise<void>(() => undefined) });

    const pending = sendSecurityNotice(doubles.deps, PLAN);
    await vi.advanceTimersByTimeAsync(SECURITY_NOTICE_TIMEOUT_MS);
    await pending;

    expect(doubles.record).toHaveBeenCalledOnce();
  });

  it('reports the loss, without the address, when delivery and the audit event both fail', async () => {
    const doubles = build({
      send: () => Promise.reject(new Error('mail down')),
      record: () => Promise.reject(new Error('audit down')),
    });

    await expect(sendSecurityNotice(doubles.deps, PLAN)).resolves.toBeUndefined();

    expect(doubles.reportLost).toHaveBeenCalledExactlyOnceWith('passkey_added');
  });
});
