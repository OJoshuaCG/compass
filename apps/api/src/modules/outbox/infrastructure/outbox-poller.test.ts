import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutboxRunOptions } from '../application/outbox-worker.js';
import type { OutboxLogger } from '../application/ports/outbox-ports.js';
import { OutboxPoller } from './outbox-poller.js';
import type { OutboxPassRunner } from './outbox-poller.js';

const INTERVAL_MS = 1000;
const STOP_TIMEOUT_MS = 5000;

/** Trabajador falso: cada pasada queda abierta hasta que la prueba la resuelve. */
class FakeWorker implements OutboxPassRunner {
  startedPasses = 0;
  concurrentPasses = 0;
  maxConcurrentPasses = 0;
  lastOptions: OutboxRunOptions | undefined;
  private readonly releasers: (() => void)[] = [];

  runOnce(options?: OutboxRunOptions): Promise<void> {
    this.startedPasses += 1;
    this.concurrentPasses += 1;
    this.maxConcurrentPasses = Math.max(this.maxConcurrentPasses, this.concurrentPasses);
    this.lastOptions = options;
    return new Promise<void>((resolve) => {
      this.releasers.push(() => {
        this.concurrentPasses -= 1;
        resolve();
      });
    });
  }

  finishOldestPass(): void {
    this.releasers.shift()?.();
  }
}

function buildLogger() {
  return {
    info: vi.fn<OutboxLogger['info']>(),
    warn: vi.fn<OutboxLogger['warn']>(),
    error: vi.fn<OutboxLogger['error']>(),
  };
}

describe('OutboxPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never overlaps passes: the next one is scheduled only after the previous one ends', async () => {
    const worker = new FakeWorker();
    const poller = new OutboxPoller({ worker, logger: buildLogger(), intervalMs: INTERVAL_MS });

    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(worker.startedPasses).toBe(1);

    // Pasada en curso: por mucho que pase el tiempo no arranca otra.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);
    expect(worker.startedPasses).toBe(1);

    worker.finishOldestPass();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(worker.startedPasses).toBe(2);
    expect(worker.maxConcurrentPasses).toBe(1);

    worker.finishOldestPass();
    await poller.stop();
  });

  it('stop() waits for the in-flight pass and tells it to stop through isStopping', async () => {
    const worker = new FakeWorker();
    const poller = new OutboxPoller({ worker, logger: buildLogger(), intervalMs: INTERVAL_MS });
    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(worker.lastOptions?.isStopping?.()).toBe(false);

    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(worker.lastOptions?.isStopping?.()).toBe(true);
    expect(stopped).toBe(false);

    worker.finishOldestPass();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('schedules no new timer after stop()', async () => {
    const worker = new FakeWorker();
    const poller = new OutboxPoller({ worker, logger: buildLogger(), intervalMs: INTERVAL_MS });
    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    const stopping = poller.stop();
    worker.finishOldestPass();
    await stopping;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);

    expect(worker.startedPasses).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the pending timer when stopped between passes', async () => {
    const worker = new FakeWorker();
    const poller = new OutboxPoller({ worker, logger: buildLogger(), intervalMs: INTERVAL_MS });
    poller.start();

    await poller.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);

    expect(worker.startedPasses).toBe(0);
  });

  it('gives up waiting after the stop timeout, logs it and returns', async () => {
    const worker = new FakeWorker();
    const logger = buildLogger();
    const poller = new OutboxPoller({
      worker,
      logger,
      intervalMs: INTERVAL_MS,
      stopTimeoutMs: STOP_TIMEOUT_MS,
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS - 1);
    expect(stopped).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(stopped).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'stop_timed_out' }),
      expect.any(String),
    );

    // La pasada atascada termina más tarde y tampoco reprograma nada.
    worker.finishOldestPass();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10);
    expect(worker.startedPasses).toBe(1);
  });
});
