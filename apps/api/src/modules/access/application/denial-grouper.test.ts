import { describe, expect, it } from 'vitest';

import { DENIAL_GROUPING_WINDOW_MS, DenialGrouper } from './denial-grouper.js';
import type { DenialKey } from './denial-grouper.js';

const KEY: DenialKey = {
  organizationId: 'org-1',
  actorId: 'actor-1',
  code: 'AUTHZ.PERMISSION',
  permission: 'user.create',
  targetUserId: null,
};

function setup(options: { maxKeys?: number } = {}) {
  let nowMs = Date.parse('2026-10-28T12:00:00Z');
  const clock = { now: () => new Date(nowMs) };
  const grouper = new DenialGrouper(clock, DENIAL_GROUPING_WINDOW_MS, options.maxKeys);
  const advance = (ms: number): void => {
    nowMs += ms;
  };
  /** Reproduce el ciclo del Authorizer: decidir y, si hay que escribir, confirmar la escritura. */
  const denyAndRecord = (key: DenialKey) => {
    const decision = grouper.decide(key);
    if (decision.record) grouper.confirmRecorded(key, decision.suppressedCount);
    return decision;
  };
  return { grouper, advance, denyAndRecord };
}

describe('DenialGrouper', () => {
  it('always records the first denial of a key', () => {
    const { denyAndRecord } = setup();

    expect(denyAndRecord(KEY)).toEqual({ record: true, suppressedCount: 0 });
  });

  it('suppresses identical denials inside the window', () => {
    const { denyAndRecord, advance } = setup();
    denyAndRecord(KEY);

    advance(DENIAL_GROUPING_WINDOW_MS - 1);

    expect(denyAndRecord(KEY)).toEqual({ record: false });
  });

  it('records again after the window and carries the suppressed count once', () => {
    const { denyAndRecord, advance } = setup();
    denyAndRecord(KEY);
    denyAndRecord(KEY);
    denyAndRecord(KEY);

    advance(DENIAL_GROUPING_WINDOW_MS);

    expect(denyAndRecord(KEY)).toEqual({ record: true, suppressedCount: 2 });
    advance(DENIAL_GROUPING_WINDOW_MS);
    expect(denyAndRecord(KEY)).toEqual({ record: true, suppressedCount: 0 });
  });

  it('keeps asking to record while the write is never confirmed (fail closed)', () => {
    const { grouper } = setup();

    expect(grouper.decide(KEY)).toEqual({ record: true, suppressedCount: 0 });
    expect(grouper.decide(KEY)).toEqual({ record: true, suppressedCount: 0 });
  });

  it.each<[string, Partial<DenialKey>]>([
    ['another organization', { organizationId: 'org-2' }],
    ['another actor', { actorId: 'actor-2' }],
    ['another reason code', { code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE' }],
    ['another permission', { permission: 'user.suspend' }],
    ['another target user', { targetUserId: 'target-1' }],
  ])('does not group denials of %s', (_label, change) => {
    const { denyAndRecord } = setup();
    denyAndRecord(KEY);

    expect(denyAndRecord({ ...KEY, ...change })).toEqual({ record: true, suppressedCount: 0 });
  });

  it('does not let an anonymous denial of one organization hide the same one of another', () => {
    const { denyAndRecord } = setup();
    denyAndRecord({ ...KEY, actorId: null, organizationId: 'org-a' });

    expect(denyAndRecord({ ...KEY, actorId: null, organizationId: 'org-b' })).toEqual({
      record: true,
      suppressedCount: 0,
    });
  });

  it('does not stay silent when the clock moves backwards', () => {
    const { denyAndRecord, advance } = setup();
    denyAndRecord(KEY);

    advance(-DENIAL_GROUPING_WINDOW_MS);

    expect(denyAndRecord(KEY)).toMatchObject({ record: true });
  });

  it('bounds memory by evicting the oldest key, so an evicted key is recorded again', () => {
    const { denyAndRecord } = setup({ maxKeys: 2 });
    denyAndRecord({ ...KEY, actorId: 'a' });
    denyAndRecord({ ...KEY, actorId: 'b' });
    denyAndRecord({ ...KEY, actorId: 'c' });

    expect(denyAndRecord({ ...KEY, actorId: 'a' })).toEqual({ record: true, suppressedCount: 0 });
  });
});
