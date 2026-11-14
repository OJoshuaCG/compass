/**
 * Pasada de borrados del worker: atiende, fuente por fuente y en serie, las que tienen peticiones pendientes.
 * Una fuente que lanza una excepción no detiene a las demás: se cuenta como `unexpected` y las suyas quedan
 * pendientes para la siguiente pasada.
 */
import type { MailDeleteSummary } from './execute-mail-delete-requests.js';
import type { Clock } from '../../../shared/kernel/index.js';
import {
  MAIL_DELETE_REQUEST_TTL_MS,
  type MailDeleteWorkStore,
} from './ports/mail-delete-work-store.js';
import type { SourceRef } from './ports/poll-state-store.js';

export interface MailDeleteSourceExecutor {
  execute(source: SourceRef): Promise<MailDeleteSummary>;
}

export interface RunMailDeleteRequestsSummary extends MailDeleteSummary {
  readonly sources: number;
}

export class RunMailDeleteRequests {
  constructor(
    private readonly deps: {
      readonly work: Pick<
        MailDeleteWorkStore,
        'listSourcesWithPending' | 'listSourcesWithStale' | 'expireStale'
      >;
      readonly executor: MailDeleteSourceExecutor;
      readonly clock: Clock;
    },
  ) {}

  async execute(): Promise<RunMailDeleteRequestsSummary> {
    const now = this.deps.clock.now();
    const cutoff = new Date(now.getTime() - MAIL_DELETE_REQUEST_TTL_MS);
    let deleted = 0;
    let failed = 0;
    let unexpected = 0;

    // Primero se cierran las vencidas, también las de fuentes suspendidas: no necesitan conexión al buzón.
    const staleSources = await this.deps.work.listSourcesWithStale(cutoff);
    for (const source of staleSources) {
      try {
        failed += await this.deps.work.expireStale(source, cutoff, now);
      } catch {
        unexpected += 1;
      }
    }

    const sources = await this.deps.work.listSourcesWithPending();
    for (const source of sources) {
      try {
        const result = await this.deps.executor.execute(source);
        deleted += result.deleted;
        failed += result.failed;
        unexpected += result.unexpected;
      } catch {
        unexpected += 1;
      }
    }
    return { sources: sources.length, deleted, failed, unexpected };
  }
}
