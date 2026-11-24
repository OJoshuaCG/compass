import { describe, expect, it } from 'vitest';

import {
  AUDIT_PARTITION_MIN_RUNWAY_MONTHS,
  AUDIT_PARTITION_TARGET_AHEAD_MONTHS,
  EnsureAuditPartitions,
} from './ensure-audit-partitions.js';
import type { AuditPartitionAdmin } from './ports/audit-partition-ports.js';

const NOW = new Date('2026-11-21T12:00:00.000Z');

function fakeAdmin(last: string | null, failOn: string | null = null) {
  const created: string[] = [];
  const admin: AuditPartitionAdmin = {
    lastMonthlyPartition: () => Promise.resolve(last),
    createMonthPartition: (month) => {
      if (month === failOn) {
        return Promise.reject(Object.assign(new Error('private detail'), { code: '22023' }));
      }
      created.push(month);
      return Promise.resolve(`audit_events_p${month.slice(0, 7).replace('-', '')}`);
    },
  };
  return { admin, created };
}

describe('EnsureAuditPartitions', () => {
  it('creates nothing and reports no alert when the target runway already exists', async () => {
    const { admin, created } = fakeAdmin('2028-11-01');

    const summary = await new EnsureAuditPartitions({ admin, clock: { now: () => NOW } }).execute();

    expect(created).toEqual([]);
    expect(summary).toEqual({
      createdMonths: [],
      runwayBeforeMonths: AUDIT_PARTITION_TARGET_AHEAD_MONTHS,
      runwayAfterMonths: AUDIT_PARTITION_TARGET_AHEAD_MONTHS,
      lowRunway: false,
      failure: null,
    });
  });

  it('creates the next month when the runway is one month short, crossing the year boundary in order', async () => {
    const { admin, created } = fakeAdmin('2028-10-01');

    const summary = await new EnsureAuditPartitions({ admin, clock: { now: () => NOW } }).execute();

    expect(created).toEqual(['2028-11-01']);
    expect(summary.runwayBeforeMonths).toBe(23);
    expect(summary.runwayAfterMonths).toBe(24);
    expect(summary.lowRunway).toBe(false);
  });

  it('catches up every missed month across a December to January boundary and raises the alert', async () => {
    const { admin, created } = fakeAdmin('2026-12-01');

    const summary = await new EnsureAuditPartitions({ admin, clock: { now: () => NOW } }).execute();

    expect(created[0]).toBe('2027-01-01');
    expect(created).toHaveLength(23);
    expect(created.at(-1)).toBe('2028-11-01');
    expect(summary.runwayBeforeMonths).toBe(1);
    expect(summary.lowRunway).toBe(true);
    expect(summary.failure).toBeNull();
  });

  it('alerts at five months of runway and not at six', async () => {
    const five = await new EnsureAuditPartitions({
      admin: fakeAdmin('2027-04-01').admin,
      clock: { now: () => NOW },
    }).execute();
    const six = await new EnsureAuditPartitions({
      admin: fakeAdmin('2027-05-01').admin,
      clock: { now: () => NOW },
    }).execute();

    expect(five.runwayBeforeMonths).toBe(AUDIT_PARTITION_MIN_RUNWAY_MONTHS - 1);
    expect(five.lowRunway).toBe(true);
    expect(six.runwayBeforeMonths).toBe(AUDIT_PARTITION_MIN_RUNWAY_MONTHS);
    expect(six.lowRunway).toBe(false);
  });

  it('starts after the current month when there is no monthly partition, because the legacy one covers it', async () => {
    const { admin, created } = fakeAdmin(null);

    const summary = await new EnsureAuditPartitions({ admin, clock: { now: () => NOW } }).execute();

    expect(created[0]).toBe('2026-12-01');
    expect(created).toHaveLength(AUDIT_PARTITION_TARGET_AHEAD_MONTHS);
    expect(summary.runwayBeforeMonths).toBe(0);
    expect(summary.lowRunway).toBe(true);
  });

  it('uses the UTC month, not the host month, at the boundary', async () => {
    const lastMomentOfNovember = new Date('2026-11-30T23:59:59.999Z');
    const { admin, created } = fakeAdmin('2028-11-01');

    await new EnsureAuditPartitions({
      admin,
      clock: { now: () => lastMomentOfNovember },
    }).execute();
    expect(created).toEqual([]);

    const firstMomentOfDecember = new Date('2026-12-01T00:00:00.000Z');
    const next = fakeAdmin('2028-11-01');
    await new EnsureAuditPartitions({
      admin: next.admin,
      clock: { now: () => firstMomentOfDecember },
    }).execute();
    expect(next.created).toEqual(['2028-12-01']);
  });

  it('stops at the first failure and reports its name and code without the message', async () => {
    const { admin, created } = fakeAdmin('2028-08-01', '2028-10-01');

    const summary = await new EnsureAuditPartitions({ admin, clock: { now: () => NOW } }).execute();

    expect(created).toEqual(['2028-09-01']);
    expect(summary.createdMonths).toEqual(['2028-09-01']);
    expect(summary.runwayAfterMonths).toBe(22);
    expect(summary.failure).toBe('Error (22023)');
    expect(JSON.stringify(summary)).not.toContain('private detail');
  });
});
