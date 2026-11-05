/**
 * Una pasada completa del worker de correo entrante (ADR 0045): lista las fuentes que tocan y sondea cada
 * una con `PollMailSource`, en serie y dentro de un presupuesto de tiempo.
 *
 * Invariantes
 * - Una fuente que falla (buzón caído, credenciales malas) NO detiene a las demás: el fallo ya quedó anotado
 *   con su backoff por `PollMailSource`.
 * - Una excepción que escapa de `PollMailSource` es un defecto, no un fallo del buzón: se cuenta aparte
 *   (`unexpected`) para que el proceso salga con código distinto de cero y alguien lo mire.
 * - Pasado el presupuesto no se empieza ninguna fuente más; las que quedan se atienden en la siguiente pasada.
 */
import type { Clock } from '../../../shared/kernel/index.js';
import type { PollSourceResult } from './poll-mail-source.js';
import type { PollableSourceLister } from './ports/pollable-source-lister.js';
import type { SourceRef } from './ports/poll-state-store.js';

/** Contador de fallos inesperados bajo la misma clave que un código de fallo, para que el resumen sea uniforme. */
const UNEXPECTED_ERROR_CODE = 'UNEXPECTED';
/**
 * Códigos de fallo que no son del buzón de una fuente sino del propio sistema: un defecto o el KMS caído
 * afectan a todas las fuentes y alguien debe enterarse por el código de salida, no por el retroceso.
 * `PollMailSource` los devuelve como resultado `failed`, no como excepción.
 */
const SYSTEM_FAILURE_CODES: ReadonlySet<string> = new Set([
  UNEXPECTED_ERROR_CODE,
  'KMS_UNAVAILABLE',
]);

export interface InboundSourcePoller {
  execute(source: SourceRef): Promise<PollSourceResult>;
}

export interface PollInboundSourcesSettings {
  /** Tope de fuentes que se intentan en una pasada. */
  readonly maxSourcesPerRun: number;
  /** Tiempo total tras el cual no se empieza otra fuente. */
  readonly runBudgetMs: number;
}

export interface PollInboundSourcesSummary {
  readonly listed: number;
  readonly attempted: number;
  readonly completed: number;
  readonly skippedLeased: number;
  readonly failed: number;
  readonly failedByCode: Readonly<Record<string, number>>;
  /** Fallos del sistema (defecto o KMS caído), sea por excepción o por código devuelto: no son del buzón. */
  readonly unexpected: number;
  readonly accepted: number;
  readonly quarantined: number;
  /** Listadas pero sin intentar por el tope de fuentes o por el presupuesto de tiempo. */
  readonly deferred: number;
}

export class PollInboundSources {
  constructor(
    private readonly deps: {
      readonly lister: PollableSourceLister;
      readonly poller: InboundSourcePoller;
      readonly clock: Clock;
      readonly settings: PollInboundSourcesSettings;
    },
  ) {}

  async execute(): Promise<PollInboundSourcesSummary> {
    const { lister, poller, clock, settings } = this.deps;
    const startedAtMs = clock.now().getTime();
    const sources = await lister.list();

    const failedByCode: Record<string, number> = {};
    let attempted = 0;
    let completed = 0;
    let skippedLeased = 0;
    let failed = 0;
    let unexpected = 0;
    let accepted = 0;
    let quarantined = 0;

    const countFailure = (code: string): void => {
      failed += 1;
      failedByCode[code] = (failedByCode[code] ?? 0) + 1;
    };

    for (const source of sources) {
      const elapsedMs = clock.now().getTime() - startedAtMs;
      if (attempted >= settings.maxSourcesPerRun || elapsedMs >= settings.runBudgetMs) break;
      attempted += 1;

      let result: PollSourceResult;
      try {
        result = await poller.execute(source);
      } catch {
        // No se conserva el mensaje de la excepción: podría arrastrar texto del servidor o datos del buzón.
        unexpected += 1;
        countFailure(UNEXPECTED_ERROR_CODE);
        continue;
      }

      if (result.status === 'skipped_leased') {
        skippedLeased += 1;
      } else if (result.status === 'failed') {
        countFailure(result.errorCode);
        if (SYSTEM_FAILURE_CODES.has(result.errorCode)) unexpected += 1;
      } else {
        completed += 1;
        accepted += result.summary.accepted;
        quarantined += Object.values(result.summary.quarantinedByReason).reduce(
          (total, count) => total + count,
          0,
        );
      }
    }

    return {
      listed: sources.length,
      attempted,
      completed,
      skippedLeased,
      failed,
      failedByCode,
      unexpected,
      accepted,
      quarantined,
      deferred: sources.length - attempted,
    };
  }
}
