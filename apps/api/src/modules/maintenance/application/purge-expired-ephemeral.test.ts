import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { OutboxRetentionStore, ReplacedTotpSecretStore } from './ports/purge-ports.js';
import {
  EXPIRED_RETENTION_GRACE_MS,
  OUTBOX_RETENTION_DAYS,
  OUTBOX_RETENTION_MS,
  PURGE_BATCH_SIZE,
  PurgeExpiredEphemeral,
  REPLACED_TOTP_SECRET_RETENTION_DAYS,
  REPLACED_TOTP_SECRET_RETENTION_MS,
} from './purge-expired-ephemeral.js';

const ORG_OK = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const NOW = new Date('2026-01-01T12:00:00.000Z');

const passthroughScope: TenantScope = {
  runAs: (_context, fn) => fn(),
  runAsAtomic: (_context, fn) => fn(),
};

const noReplacedTotpSecrets: ReplacedTotpSecretStore = {
  purgeReplacedTotpSecrets: () => Promise.resolve(0),
};

const noPublishedOutboxEvents: OutboxRetentionStore = {
  purgePublishedEvents: () => Promise.resolve({ events: 0, deliveries: 0 }),
};

describe('PurgeExpiredEphemeral', () => {
  it('uses the grace period as the cutoff and drains full batches until a short one', async () => {
    const cutoffs: Date[] = [];
    const batches = [PURGE_BATCH_SIZE, 7];
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      store: {
        purgeIdempotencyKeys: (expiredBefore) => {
          cutoffs.push(expiredBefore);
          return Promise.resolve(batches.shift() ?? 0);
        },
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: noReplacedTotpSecrets,
      outboxRetention: noPublishedOutboxEvents,
      scope: passthroughScope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(summary.idempotencyKeys).toBe(PURGE_BATCH_SIZE + 7);
    expect(cutoffs).toHaveLength(2);
    expect(cutoffs[0]?.getTime()).toBe(NOW.getTime() - EXPIRED_RETENTION_GRACE_MS);
  });

  it('keeps purging the other organizations when one fails and reports it', async () => {
    const seen: string[] = [];
    const scope: TenantScope = {
      runAs: (context, fn) => {
        if (context.organizationId === ORG_BROKEN) return Promise.reject(new Error('boom'));
        seen.push(context.organizationId);
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_BROKEN, ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(1),
        purgeWebauthnChallenges: () => Promise.resolve(2),
      },
      replacedTotpSecrets: noReplacedTotpSecrets,
      outboxRetention: noPublishedOutboxEvents,
      scope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([{ organizationId: ORG_BROKEN, reason: 'Error' }]);
    expect(summary.idempotencyKeys).toBe(1);
    expect(summary.webauthnChallenges).toBe(2);
    expect(seen).toContain(ORG_OK);
  });

  it('uses a 30-day cutoff for replaced TOTP secret versions and drains full batches', async () => {
    const cutoffs: Date[] = [];
    const batches = [PURGE_BATCH_SIZE, 3];
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: {
        purgeReplacedTotpSecrets: (replacedBefore) => {
          cutoffs.push(replacedBefore);
          return Promise.resolve(batches.shift() ?? 0);
        },
      },
      outboxRetention: noPublishedOutboxEvents,
      scope: passthroughScope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(REPLACED_TOTP_SECRET_RETENTION_DAYS).toBe(30);
    expect(summary.replacedTotpSecrets).toBe(PURGE_BATCH_SIZE + 3);
    expect(cutoffs).toHaveLength(2);
    expect(cutoffs[0]?.getTime()).toBe(NOW.getTime() - REPLACED_TOTP_SECRET_RETENTION_MS);
  });

  it('runs the replaced TOTP secret purge as a system job with the organization context', async () => {
    const contexts: { organizationId: string; actorId: string | null }[] = [];
    const scope: TenantScope = {
      runAs: (context, fn) => {
        contexts.push({ organizationId: context.organizationId, actorId: context.actorId });
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: { purgeReplacedTotpSecrets: () => Promise.resolve(0) },
      outboxRetention: noPublishedOutboxEvents,
      scope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    await purge.execute();

    expect(contexts).toContainEqual({ organizationId: ORG_OK, actorId: null });
  });

  it('reports a failure of the replaced TOTP purge without stopping the other organizations', async () => {
    const purged: string[] = [];
    let current = '';
    const scope: TenantScope = {
      runAs: (context, fn) => {
        current = context.organizationId;
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_BROKEN, ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: {
        purgeReplacedTotpSecrets: () => {
          if (current === ORG_BROKEN) return Promise.reject(new Error('boom'));
          purged.push(current);
          return Promise.resolve(2);
        },
      },
      outboxRetention: noPublishedOutboxEvents,
      scope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([{ organizationId: ORG_BROKEN, reason: 'Error' }]);
    expect(summary.replacedTotpSecrets).toBe(2);
    expect(purged).toEqual([ORG_OK]);
  });

  it('uses a 7-day cutoff for published outbox events and drains full batches until a short one', async () => {
    const cutoffs: Date[] = [];
    const limits: number[] = [];
    const batches = [PURGE_BATCH_SIZE, 4];
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: noReplacedTotpSecrets,
      outboxRetention: {
        purgePublishedEvents: (publishedBefore, limit) => {
          cutoffs.push(publishedBefore);
          limits.push(limit);
          const events = batches.shift() ?? 0;
          // Un evento puede tener varios acuses o ninguno: los acuses no marcan el fin del recorrido.
          return Promise.resolve({ events, deliveries: events * 2 });
        },
      },
      scope: passthroughScope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(OUTBOX_RETENTION_DAYS).toBe(7);
    expect(summary.outboxEvents).toBe(PURGE_BATCH_SIZE + 4);
    expect(summary.outboxDeliveries).toBe((PURGE_BATCH_SIZE + 4) * 2);
    expect(cutoffs).toHaveLength(2);
    expect(cutoffs[0]?.getTime()).toBe(NOW.getTime() - OUTBOX_RETENTION_MS);
    expect(limits).toEqual([PURGE_BATCH_SIZE, PURGE_BATCH_SIZE]);
  });

  it('runs the outbox retention as a system job with the organization context', async () => {
    const contexts: { organizationId: string; actorId: string | null }[] = [];
    const scope: TenantScope = {
      runAs: (context, fn) => {
        contexts.push({ organizationId: context.organizationId, actorId: context.actorId });
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: noReplacedTotpSecrets,
      outboxRetention: {
        purgePublishedEvents: () => Promise.resolve({ events: 1, deliveries: 1 }),
      },
      scope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    await purge.execute();

    expect(contexts).toContainEqual({ organizationId: ORG_OK, actorId: null });
  });

  it('reports a failure of the outbox retention without stopping the other organizations', async () => {
    const purged: string[] = [];
    let current = '';
    const scope: TenantScope = {
      runAs: (context, fn) => {
        current = context.organizationId;
        return fn();
      },
      runAsAtomic: (_context, fn) => fn(),
    };
    const purge = new PurgeExpiredEphemeral({
      organizations: { listIds: () => Promise.resolve([ORG_BROKEN, ORG_OK]) },
      store: {
        purgeIdempotencyKeys: () => Promise.resolve(0),
        purgeWebauthnChallenges: () => Promise.resolve(0),
      },
      replacedTotpSecrets: noReplacedTotpSecrets,
      outboxRetention: {
        purgePublishedEvents: () => {
          if (current === ORG_BROKEN) return Promise.reject(new Error('boom'));
          purged.push(current);
          return Promise.resolve({ events: 2, deliveries: 3 });
        },
      },
      scope,
      ids: { next: () => 'req-1' },
      clock: { now: () => NOW },
    });

    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([{ organizationId: ORG_BROKEN, reason: 'Error' }]);
    expect(summary.outboxEvents).toBe(2);
    expect(summary.outboxDeliveries).toBe(3);
    expect(purged).toEqual([ORG_OK]);
  });
});
