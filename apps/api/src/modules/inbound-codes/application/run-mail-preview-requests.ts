/**
 * Pasada de vistas previas del worker: primero purga lo vencido (también de fuentes suspendidas, sin abrir el
 * buzón) y luego atiende, fuente por fuente y en serie, las que tienen peticiones pendientes. Una fuente que
 * lanza una excepción no detiene a las demás: se cuenta como `unexpected` y las suyas quedan para la siguiente
 * pasada (o vencen).
 */
import type { Clock } from '../../../shared/kernel/index.js';
import type { MailPreviewSummary } from './execute-mail-preview-requests.js';
import type { MailPreviewWorkStore } from './ports/mail-preview-work-store.js';
import type { SourceRef } from './ports/poll-state-store.js';

export interface MailPreviewSourceExecutor {
  execute(source: SourceRef): Promise<MailPreviewSummary>;
}

export interface RunMailPreviewRequestsSummary extends MailPreviewSummary {
  readonly sources: number;
  readonly purged: number;
}

export class RunMailPreviewRequests {
  constructor(
    private readonly deps: {
      readonly work: Pick<
        MailPreviewWorkStore,
        'listSourcesWithPending' | 'listSourcesWithExpired' | 'purgeExpired'
      >;
      readonly executor: MailPreviewSourceExecutor;
      readonly clock: Clock;
    },
  ) {}

  async execute(): Promise<RunMailPreviewRequestsSummary> {
    const now = this.deps.clock.now();
    let ready = 0;
    let failed = 0;
    let unexpected = 0;
    let purged = 0;

    // El contenido cifrado vencido no debe quedarse en la base aunque su fuente ya no esté activa.
    const expiredSources = await this.deps.work.listSourcesWithExpired(now);
    for (const source of expiredSources) {
      try {
        purged += await this.deps.work.purgeExpired(source, now);
      } catch {
        unexpected += 1;
      }
    }

    const sources = await this.deps.work.listSourcesWithPending(now);
    for (const source of sources) {
      try {
        const result = await this.deps.executor.execute(source);
        ready += result.ready;
        failed += result.failed;
        unexpected += result.unexpected;
      } catch {
        unexpected += 1;
      }
    }
    return { sources: sources.length, purged, ready, failed, unexpected };
  }
}
