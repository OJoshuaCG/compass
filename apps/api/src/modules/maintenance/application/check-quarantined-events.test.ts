import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import {
  CheckQuarantinedEvents,
  QUARANTINE_ALERT_REPEAT_INTERVAL_MS,
} from './check-quarantined-events.js';

const ORG_WITH_EVENTS = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_CLEAN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000003');
const NOW = new Date('2026-01-01T12:00:00.000Z');

// Cada prueba sabe en qué organización corre el bloque porque el alcance la fija antes de ejecutarlo.
function buildHarness(options: {
  quarantinedByOrganization: Record<string, number>;
  alertedRecentlyOrganizations?: string[];
  brokenOrganizations?: string[];
}) {
  let currentOrganization = '';
  const alerts: { organizationId: string; occurredAt: Date }[] = [];
  const historyQueries: Date[] = [];

  const scope: TenantScope = {
    runAs: async (context, fn) => {
      currentOrganization = context.organizationId;
      return fn();
    },
    runAsAtomic: async (context, fn) => {
      currentOrganization = context.organizationId;
      return fn();
    },
  };

  const check = new CheckQuarantinedEvents({
    organizations: {
      listIds: () =>
        Promise.resolve(
          [ORG_WITH_EVENTS, ORG_CLEAN, ORG_BROKEN].filter(
            (id) => id in options.quarantinedByOrganization,
          ),
        ),
    },
    counter: {
      countQuarantinedEvents: () => {
        if (options.brokenOrganizations?.includes(currentOrganization) === true) {
          return Promise.reject(Object.assign(new Error('secret detail'), { code: '57P01' }));
        }
        return Promise.resolve(options.quarantinedByOrganization[currentOrganization] ?? 0);
      },
    },
    history: {
      hasQuarantineAlertSince: (since) => {
        historyQueries.push(since);
        return Promise.resolve(
          options.alertedRecentlyOrganizations?.includes(currentOrganization) === true,
        );
      },
    },
    alerter: {
      alertQuarantinedEvents: (occurredAt) => {
        alerts.push({ organizationId: currentOrganization, occurredAt });
        return Promise.resolve();
      },
    },
    scope,
    ids: { next: () => '0198bbbb-0000-7000-8000-000000000001' },
    clock: { now: () => NOW },
  });

  return { check, alerts, historyQueries };
}

describe('CheckQuarantinedEvents', () => {
  it('enqueues one alert for an organization with quarantined events and none for a clean one', async () => {
    const { check, alerts } = buildHarness({
      quarantinedByOrganization: { [ORG_WITH_EVENTS]: 3, [ORG_CLEAN]: 0 },
    });

    const summary = await check.execute();

    expect(alerts).toEqual([{ organizationId: ORG_WITH_EVENTS, occurredAt: NOW }]);
    expect(summary).toEqual({
      organizations: 2,
      organizationsWithQuarantinedEvents: 1,
      alertsEnqueued: 1,
      failedOrganizations: [],
    });
  });

  it('does not repeat the alert while the previous one is less than a day old', async () => {
    const { check, alerts, historyQueries } = buildHarness({
      quarantinedByOrganization: { [ORG_WITH_EVENTS]: 1 },
      alertedRecentlyOrganizations: [ORG_WITH_EVENTS],
    });

    const summary = await check.execute();

    expect(alerts).toEqual([]);
    expect(historyQueries).toEqual([new Date(NOW.getTime() - QUARANTINE_ALERT_REPEAT_INTERVAL_MS)]);
    expect(summary.organizationsWithQuarantinedEvents).toBe(1);
    expect(summary.alertsEnqueued).toBe(0);
  });

  it('does not consult the history when nothing is quarantined', async () => {
    const { check, historyQueries } = buildHarness({
      quarantinedByOrganization: { [ORG_CLEAN]: 0 },
    });

    await check.execute();

    expect(historyQueries).toEqual([]);
  });

  it('keeps checking the other organizations when one fails and reports only the error name and code', async () => {
    const { check, alerts } = buildHarness({
      quarantinedByOrganization: { [ORG_WITH_EVENTS]: 2, [ORG_BROKEN]: 5 },
      brokenOrganizations: [ORG_BROKEN],
    });

    const summary = await check.execute();

    expect(alerts.map((alert) => alert.organizationId)).toEqual([ORG_WITH_EVENTS]);
    expect(summary.failedOrganizations).toEqual([
      { organizationId: ORG_BROKEN, reason: 'Error (57P01)' },
    ]);
  });
});
