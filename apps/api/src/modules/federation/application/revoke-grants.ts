/**
 * Revocación de concesiones OIDC cuando la sesión de Compass deja de valer (ADR 0051 §3, ADR 0052).
 *
 * Invariantes de seguridad
 * - No abre transacción propia: corre dentro de la del llamador, así la revocación, el aviso a las
 *   aplicaciones (outbox) y la auditoría de quien cerró la sesión confirman o se revierten juntas.
 * - Los avisos de logout se leen ANTES de borrar (después ya no queda a quién avisar) y se encolan solo con
 *   identificadores; el contenido de una concesión nunca se devuelve.
 */
import type { BackchannelLogoutQueue } from './ports/backchannel-logout-queue.js';
import type { GrantStore } from './ports/grant-store.js';
import type { BackchannelLogoutTarget } from '../domain/backchannel-logout.js';

export class RevokeGrants {
  constructor(
    private readonly store: GrantStore,
    private readonly logoutQueue: BackchannelLogoutQueue,
  ) {}

  async forSessions(sessionIds: readonly string[]): Promise<number> {
    if (sessionIds.length === 0) return 0;
    await this.enqueueAll(await this.store.findLogoutTargetsBySessions(sessionIds));
    return this.store.deleteBySessions(sessionIds);
  }

  async forUserExceptSession(userId: string, keepSessionId: string): Promise<number> {
    await this.enqueueAll(
      await this.store.findLogoutTargetsByUserExceptSession(userId, keepSessionId),
    );
    return this.store.deleteByUserExceptSession(userId, keepSessionId);
  }

  async forUser(userId: string): Promise<number> {
    await this.enqueueAll(await this.store.findLogoutTargetsByUser(userId));
    return this.store.deleteByUser(userId);
  }

  private async enqueueAll(targets: readonly BackchannelLogoutTarget[]): Promise<void> {
    for (const target of targets) await this.logoutQueue.enqueue(target);
  }
}
