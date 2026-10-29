import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { PENDING_TOTP_NOTICE_AFTER_MS } from '../domain/pending-totp-notice.js';
import type { DuePendingTotp } from '../domain/pending-totp-notice.js';
import {
  EnqueuePendingTotpNotices,
  PENDING_TOTP_SWEEP_BATCH_SIZE,
  PENDING_TOTP_SWEEP_MIN_INTERVAL_MS,
} from './enqueue-pending-totp-notices.js';
import type { PendingTotpNoticeStore } from './ports/pending-totp-notice-store.js';

const ORG_OK = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const START = new Date('2026-03-04T12:00:00.000Z');

const passthroughScope: TenantScope = {
  runAs: (_context, fn) => fn(),
  runAsAtomic: (_context, fn) => fn(),
};

function dueNotice(index: number): DuePendingTotp {
  return {
    credentialId: `0198bbbb-0000-7000-8000-${String(index).padStart(12, '0')}`,
    registeredBy: '0198cccc-0000-7000-8000-000000000001',
    registeredAt: new Date('2026-03-03T10:00:00.000Z'),
  };
}

function buildSweep(
  options: {
    readonly batches?: DuePendingTotp[][];
    readonly organizations?: ReturnType<typeof asOrganizationId>[];
    readonly scope?: TenantScope;
    readonly clock?: { now: () => Date };
  } = {},
) {
  const claims: { registeredBefore: Date; noticeAt: Date; limit: number }[] = [];
  const enqueued: DuePendingTotp[] = [];
  const batches = options.batches ?? [[]];
  const store: PendingTotpNoticeStore = {
    claimDue: (registeredBefore, noticeAt, limit) => {
      claims.push({ registeredBefore, noticeAt, limit });
      return Promise.resolve(batches.shift() ?? []);
    },
    enqueue: (notice) => {
      enqueued.push(notice);
      return Promise.resolve();
    },
  };
  const sweep = new EnqueuePendingTotpNotices({
    organizations: { listIds: () => Promise.resolve(options.organizations ?? [ORG_OK]) },
    store,
    scope: options.scope ?? passthroughScope,
    ids: { next: () => 'req-1' },
    clock: options.clock ?? { now: () => START },
  });
  return { sweep, claims, enqueued };
}

describe('EnqueuePendingTotpNotices', () => {
  it('claims registrations older than exactly 24 hours and enqueues one notice for each', async () => {
    const { sweep, claims, enqueued } = buildSweep({ batches: [[dueNotice(1), dueNotice(2)]] });

    const summary = await sweep.execute();

    expect(summary).toEqual({ organizations: 1, enqueued: 2, failedOrganizations: 0 });
    expect(claims[0]?.registeredBefore.getTime()).toBe(
      START.getTime() - PENDING_TOTP_NOTICE_AFTER_MS,
    );
    expect(claims[0]?.noticeAt).toEqual(START);
    expect(enqueued).toHaveLength(2);
  });

  it('keeps claiming full batches until a short one', async () => {
    const fullBatch = Array.from({ length: PENDING_TOTP_SWEEP_BATCH_SIZE }, (_, index) =>
      dueNotice(index),
    );
    const { sweep, claims } = buildSweep({ batches: [fullBatch, [dueNotice(999)]] });

    const summary = await sweep.execute();

    expect(summary.enqueued).toBe(PENDING_TOTP_SWEEP_BATCH_SIZE + 1);
    expect(claims).toHaveLength(2);
  });

  it('does nothing when no registration is due', async () => {
    const { sweep, enqueued } = buildSweep();

    const summary = await sweep.execute();

    expect(summary.enqueued).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it('runs each organization inside its own tenant scope, without an actor', async () => {
    const contexts: { organizationId: string; actorId: unknown }[] = [];
    const scope: TenantScope = {
      runAs: (context, fn) => {
        contexts.push({ organizationId: context.organizationId, actorId: context.actorId });
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const { sweep } = buildSweep({ organizations: [ORG_OK, ORG_BROKEN], scope });

    await sweep.execute();

    expect(contexts).toEqual([
      { organizationId: ORG_OK, actorId: null },
      { organizationId: ORG_BROKEN, actorId: null },
    ]);
  });

  it('keeps sweeping the other organizations when one fails and reports it', async () => {
    const scope: TenantScope = {
      runAs: (context, fn) =>
        context.organizationId === ORG_BROKEN ? Promise.reject(new Error('boom')) : fn(),
      runAsAtomic: (_context, fn) => fn(),
    };
    const { sweep } = buildSweep({
      organizations: [ORG_BROKEN, ORG_OK],
      scope,
      batches: [[dueNotice(1)]],
    });

    const summary = await sweep.execute();

    expect(summary).toEqual({ organizations: 2, enqueued: 1, failedOrganizations: 1 });
  });

  it('stops taking work once the worker is shutting down', async () => {
    const { sweep, claims } = buildSweep({ batches: [[dueNotice(1)]] });

    const summary = await sweep.execute({ isStopping: () => true });

    expect(summary.enqueued).toBe(0);
    expect(claims).toHaveLength(0);
  });

  describe('executeIfDue', () => {
    it('sweeps on the first call and skips until the minimum interval has passed', async () => {
      let current = START;
      const { sweep, claims } = buildSweep({ clock: { now: () => current } });

      expect(await sweep.executeIfDue()).not.toBeNull();
      current = new Date(START.getTime() + PENDING_TOTP_SWEEP_MIN_INTERVAL_MS - 1);
      expect(await sweep.executeIfDue()).toBeNull();
      current = new Date(START.getTime() + PENDING_TOTP_SWEEP_MIN_INTERVAL_MS);
      expect(await sweep.executeIfDue()).not.toBeNull();

      expect(claims).toHaveLength(2);
    });
  });
});
