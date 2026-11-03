import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { Clock } from '../../../shared/kernel/index.js';
import type { PollSourceResult } from './poll-mail-source.js';
import { PollInboundSources } from './poll-inbound-sources.js';
import type { PollInboundSourcesSettings } from './poll-inbound-sources.js';
import type { SourceRef } from './ports/poll-state-store.js';

const ONE_SECOND_MS = 1000;
const ORGANIZATION = asOrganizationId('0197a000-0000-7000-8000-000000000001');

function source(index: number): SourceRef {
  return { organizationId: ORGANIZATION, sourceId: `source-${String(index)}` };
}

const COMPLETED: PollSourceResult = {
  status: 'completed',
  summary: {
    templatesFound: 1,
    listed: 3,
    accepted: 2,
    quarantinedByReason: { NO_MATCHING_TEMPLATE: 1, EXTRACTION_FAILED: 2 },
    duplicates: 0,
    skippedByPrefilter: 0,
    droppedByCap: 0,
    abandonedByBudget: 0,
  },
};

/** Reloj que avanza una cantidad fija cada vez que se consulta, para simular el paso del tiempo por fuente. */
class SteppingClock implements Clock {
  private current = 0;
  constructor(private readonly stepMs: number) {}
  now(): Date {
    const value = new Date(Date.UTC(2026, 10, 2, 10, 0, 0) + this.current);
    this.current += this.stepMs;
    return value;
  }
}

function build(options: {
  readonly sources: readonly SourceRef[];
  readonly results: (source: SourceRef) => PollSourceResult | Error;
  readonly settings?: Partial<PollInboundSourcesSettings>;
  readonly clockStepMs?: number;
}) {
  const polled: string[] = [];
  const useCase = new PollInboundSources({
    lister: { list: () => Promise.resolve(options.sources) },
    poller: {
      execute: (polledSource) => {
        polled.push(polledSource.sourceId);
        const result = options.results(polledSource);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    },
    clock: new SteppingClock(options.clockStepMs ?? 0),
    settings: { maxSourcesPerRun: 50, runBudgetMs: 50 * ONE_SECOND_MS, ...options.settings },
  });
  return { useCase, polled };
}

describe('PollInboundSources', () => {
  it('polls every listed source and adds up accepted and quarantined messages', async () => {
    const { useCase, polled } = build({
      sources: [source(1), source(2)],
      results: () => COMPLETED,
    });

    const summary = await useCase.execute();

    expect(polled).toEqual(['source-1', 'source-2']);
    expect(summary).toMatchObject({
      listed: 2,
      attempted: 2,
      completed: 2,
      accepted: 4,
      quarantined: 6,
      failed: 0,
      unexpected: 0,
      deferred: 0,
    });
  });

  it('keeps going after a source fails and groups the failures by code', async () => {
    const { useCase, polled } = build({
      sources: [source(1), source(2), source(3), source(4)],
      results: (polledSource) => {
        if (polledSource.sourceId === 'source-1') return { status: 'failed', errorCode: 'AUTH' };
        if (polledSource.sourceId === 'source-2') return { status: 'failed', errorCode: 'AUTH' };
        if (polledSource.sourceId === 'source-3') return { status: 'skipped_leased' };
        return COMPLETED;
      },
    });

    const summary = await useCase.execute();

    expect(polled).toHaveLength(4);
    expect(summary).toMatchObject({
      completed: 1,
      failed: 2,
      failedByCode: { AUTH: 2 },
      skippedLeased: 1,
      unexpected: 0,
    });
  });

  it('counts an exception that escapes a source as a defect without leaking its text', async () => {
    const { useCase, polled } = build({
      sources: [source(1), source(2)],
      results: (polledSource) =>
        polledSource.sourceId === 'source-1' ? new Error('texto interno del servidor') : COMPLETED,
    });

    const summary = await useCase.execute();

    expect(polled).toEqual(['source-1', 'source-2']);
    expect(summary.unexpected).toBe(1);
    expect(summary.failedByCode).toEqual({ UNEXPECTED: 1 });
    expect(JSON.stringify(summary)).not.toContain('texto interno');
    expect(summary.completed).toBe(1);
  });

  it.each(['UNEXPECTED', 'KMS_UNAVAILABLE'])(
    'counts the returned system failure %s as unexpected so the process can exit non-zero',
    async (errorCode) => {
      const { useCase } = build({
        sources: [source(1), source(2)],
        results: (polledSource) =>
          polledSource.sourceId === 'source-1' ? { status: 'failed', errorCode } : COMPLETED,
      });

      const summary = await useCase.execute();

      expect(summary).toMatchObject({ failed: 1, unexpected: 1, completed: 1 });
    },
  );

  it.each(['AUTH', 'TLS', 'TIMEOUT', 'NETWORK', 'PASSWORD_UNREADABLE', 'CONNECTION_MISSING'])(
    'does not count the per-source failure %s as unexpected',
    async (errorCode) => {
      const { useCase } = build({
        sources: [source(1)],
        results: () => ({ status: 'failed', errorCode }),
      });

      expect(await useCase.execute()).toMatchObject({ failed: 1, unexpected: 0 });
    },
  );

  it('stops at the per-run source cap and reports the rest as deferred', async () => {
    const { useCase, polled } = build({
      sources: [source(1), source(2), source(3), source(4), source(5)],
      results: () => COMPLETED,
      settings: { maxSourcesPerRun: 2 },
    });

    const summary = await useCase.execute();

    expect(polled).toEqual(['source-1', 'source-2']);
    expect(summary).toMatchObject({ listed: 5, attempted: 2, deferred: 3 });
  });

  it('does not start another source once the time budget is spent', async () => {
    // Cada consulta del reloj avanza 10 s: la segunda fuente ya llega con 20 s transcurridos.
    const { useCase, polled } = build({
      sources: [source(1), source(2), source(3)],
      results: () => COMPLETED,
      settings: { runBudgetMs: 15 * ONE_SECOND_MS },
      clockStepMs: 10 * ONE_SECOND_MS,
    });

    const summary = await useCase.execute();

    expect(polled).toEqual(['source-1']);
    expect(summary).toMatchObject({ attempted: 1, deferred: 2 });
  });

  it('does nothing when no source is pollable', async () => {
    const { useCase, polled } = build({ sources: [], results: () => COMPLETED });

    const summary = await useCase.execute();

    expect(polled).toEqual([]);
    expect(summary).toMatchObject({ listed: 0, attempted: 0, deferred: 0 });
  });
});
