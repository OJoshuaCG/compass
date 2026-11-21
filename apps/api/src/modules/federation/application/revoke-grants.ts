/**
 * Revocación de concesiones OIDC cuando la sesión de Compass deja de valer (ADR 0051 §3, ADR 0052).
 *
 * Invariantes de seguridad
 * - No abre transacción propia: corre dentro de la del llamador, así la revocación y la auditoría de
 *   quien cerró la sesión confirman o se revierten juntas.
 * - Solo borra; nunca lee ni devuelve el contenido de una concesión.
 */
import type { GrantStore } from './ports/grant-store.js';

export class RevokeGrants {
  constructor(private readonly store: GrantStore) {}

  async forSessions(sessionIds: readonly string[]): Promise<number> {
    if (sessionIds.length === 0) return 0;
    return this.store.deleteBySessions(sessionIds);
  }

  async forUser(userId: string): Promise<number> {
    return this.store.deleteByUser(userId);
  }
}
