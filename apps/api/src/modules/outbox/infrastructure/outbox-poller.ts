import type { OutboxLogger } from '../application/ports/outbox-ports.js';
import type { OutboxRunOptions } from '../application/outbox-worker.js';

/**
 * Plazo máximo que `stop()` espera a la pasada en curso. Debe superar `OUTBOX_HANDLER_TIMEOUT_MS`
 * (30 s) para que un manejador lento pueda terminar o vencer antes de rendirse.
 */
export const OUTBOX_STOP_TIMEOUT_MS = 35 * 1000;

/** Lo único que el sondeo necesita del trabajador; permite sustituirlo en las pruebas. */
export interface OutboxPassRunner {
  runOnce(options?: OutboxRunOptions): Promise<unknown>;
}

interface Dependencies {
  readonly worker: OutboxPassRunner;
  readonly logger: OutboxLogger;
  readonly intervalMs: number;
  /** Espera máxima de `stop()`; por defecto `OUTBOX_STOP_TIMEOUT_MS`. */
  readonly stopTimeoutMs?: number;
}

/**
 * Sondeo periódico dentro del proceso de la API (ADR 0035, punto 4). Una pasada nunca se solapa
 * con la siguiente, y `stop()` espera a la pasada en curso para no cortar un manejador a medias
 * ni cerrar el pool bajo sus pies. La pasada recibe `isStopping`, así que tras `stop()` termina
 * en cuanto acaba el evento actual; la espera tiene tope para que un apagado no se cuelgue.
 */
export class OutboxPoller {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private running = false;

  constructor(private readonly deps: Dependencies) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const pendingPass = this.inFlight;
    if (pendingPass === null) return;

    const stopTimeoutMs = this.deps.stopTimeoutMs ?? OUTBOX_STOP_TIMEOUT_MS;
    let stopTimer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<'timed_out'>((resolve) => {
      stopTimer = setTimeout(() => {
        resolve('timed_out');
      }, stopTimeoutMs);
    });
    try {
      const result = await Promise.race([pendingPass.then(() => 'finished' as const), gaveUp]);
      if (result === 'timed_out') {
        this.deps.logger.error(
          { outcome: 'stop_timed_out', stopTimeoutMs },
          'outbox pass did not finish before shutdown',
        );
      }
    } finally {
      clearTimeout(stopTimer);
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.pass();
    }, this.deps.intervalMs);
    // El sondeo no debe mantener vivo un proceso que ya quiere terminar.
    this.timer.unref();
  }

  private async pass(): Promise<void> {
    try {
      await this.deps.worker.runOnce({ isStopping: () => !this.running });
    } catch (error) {
      // Fallo al listar organizaciones u otro error de infraestructura: se reintenta en la siguiente pasada.
      this.deps.logger.error(
        { outcome: 'run_failed', errorName: error instanceof Error ? error.name : 'UnknownError' },
        'outbox pass failed',
      );
    } finally {
      this.inFlight = null;
      this.scheduleNext();
    }
  }
}
