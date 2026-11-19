/**
 * Cascada de revocación (ADR 0051 §3): cada vez que una sesión de Compass se cierra o se revoca, las
 * concesiones OIDC que nacieron de ella se borran en la MISMA transacción, y el borrado se audita.
 *
 * Vive en la raíz de composición porque une dos módulos (identidad y federación) que no se importan entre
 * sí. Decora el repositorio de sesiones: así cualquier caso de uso que cierre sesiones (salir, "cerrar mis
 * otras sesiones", cambio de contraseña, desactivar o suspender a alguien, entrega de la Raíz) dispara la
 * cascada sin que cada uno tenga que acordarse de ella.
 *
 * El vencimiento NO pasa por aquí: las concesiones llevan `expires_at` recortado al de la sesión y el
 * adaptador exige que la sesión siga viva (L15), así que una sesión vencida ya no sirve.
 */
import type { SessionRepository } from '../modules/identity/index.js';
import type { RevokeGrants } from '../modules/federation/index.js';
import type { AuditLog } from '../modules/audit/index.js';
import type { RequestContextReader, UserId } from '../shared/kernel/index.js';

/** Motivos estables que se guardan en la auditoría (`oidc.grants_revoked`). */
export type GrantRevocationReason =
  'session_closed' | 'other_sessions_closed' | 'all_user_sessions_closed';

export interface GrantRevokingSessionRepositoryDeps {
  readonly inner: SessionRepository;
  readonly grants: RevokeGrants;
  readonly audit: AuditLog;
  readonly context: RequestContextReader;
}

export class GrantRevokingSessionRepository implements SessionRepository {
  constructor(private readonly deps: GrantRevokingSessionRepositoryDeps) {}

  insert: SessionRepository['insert'] = (session) => this.deps.inner.insert(session);
  setMfa: SessionRepository['setMfa'] = (sessionId, at) => this.deps.inner.setMfa(sessionId, at);
  setReauth: SessionRepository['setReauth'] = (sessionId, at) =>
    this.deps.inner.setReauth(sessionId, at);
  clearMfa: SessionRepository['clearMfa'] = (sessionId) => this.deps.inner.clearMfa(sessionId);
  rotateToken: SessionRepository['rotateToken'] = (sessionId, hash) =>
    this.deps.inner.rotateToken(sessionId, hash);
  touch: SessionRepository['touch'] = (sessionId, at) => this.deps.inner.touch(sessionId, at);
  listLiveOfUser: SessionRepository['listLiveOfUser'] = (userId, now, idleSince, page) =>
    this.deps.inner.listLiveOfUser(userId, now, idleSince, page);

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.deps.inner.revoke(sessionId, at);
    const count = await this.deps.grants.forSessions([sessionId]);
    await this.auditRevocation('session_closed', 'session', sessionId, count);
  }

  async revokeOfUser(sessionId: string, userId: UserId, at: Date): Promise<boolean> {
    const revoked = await this.deps.inner.revokeOfUser(sessionId, userId, at);
    // Si la sesión no era de esa persona no se toca nada: no se borran concesiones ajenas.
    if (!revoked) return false;
    const count = await this.deps.grants.forSessions([sessionId]);
    await this.auditRevocation('session_closed', 'session', sessionId, count);
    return true;
  }

  async revokeOthersOfUser(userId: UserId, exceptSessionId: string, at: Date): Promise<void> {
    await this.deps.inner.revokeOthersOfUser(userId, exceptSessionId, at);
    const count = await this.deps.grants.forUserExceptSession(userId, exceptSessionId);
    await this.auditRevocation('other_sessions_closed', 'user', userId, count);
  }

  async revokeAllOfUser(userId: UserId, at: Date): Promise<void> {
    await this.deps.inner.revokeAllOfUser(userId, at);
    const count = await this.deps.grants.forUser(userId);
    await this.auditRevocation('all_user_sessions_closed', 'user', userId, count);
  }

  /** Sin concesiones borradas no hay nada que auditar: la mayoría de los cierres de sesión no usan SSO. */
  private async auditRevocation(
    reason: GrantRevocationReason,
    targetType: 'session' | 'user',
    targetId: string,
    count: number,
  ): Promise<void> {
    if (count === 0) return;
    const current = this.deps.context.current();
    await this.deps.audit.record({
      action: 'oidc.grants_revoked',
      actorId: current.actorId,
      targetType,
      targetId,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: current.requestId,
      metadata: { reason, count },
    });
  }
}
