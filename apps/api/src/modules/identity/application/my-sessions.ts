/**
 * Sesiones propias: ver y cerrar las de la persona que consulta.
 *
 * Invariantes de seguridad
 * - Solo se listan y cierran sesiones del propio usuario del contexto; el identificador de otra
 *   persona nunca se acepta (un identificador ajeno responde igual que uno inexistente).
 * - Jamás sale el token ni su hash. La sesión actual no se cierra aquí: para eso está cerrar sesión.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  KeysetPage,
  KeysetRequest,
  RequestContextReader,
  Result,
} from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { SESSION_IDLE_MS } from '../domain/session-policy.js';
import type { SessionListing, SessionRepository } from './ports/identity-ports.js';

export interface MySession extends SessionListing {
  readonly current: boolean;
}

export class ListMySessions {
  constructor(
    private readonly deps: {
      readonly context: RequestContextReader;
      readonly uow: UnitOfWork;
      readonly sessions: SessionRepository;
      readonly clock: Clock;
    },
  ) {}

  execute(page: KeysetRequest): Promise<KeysetPage<MySession>> {
    const { context, uow, sessions, clock } = this.deps;
    return uow.run(async () => {
      const { actorId, sessionId } = context.current();
      if (actorId === null)
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      const now = clock.now();
      const live = await sessions.listLiveOfUser(
        actorId,
        now,
        new Date(now.getTime() - SESSION_IDLE_MS),
        page,
      );
      return {
        rows: live.rows.map((session) => ({ ...session, current: session.id === sessionId })),
        nextCursor: live.nextCursor,
      };
    });
  }
}

export class RevokeMySession {
  constructor(
    private readonly deps: {
      readonly context: RequestContextReader;
      readonly uow: UnitOfWork;
      readonly sessions: SessionRepository;
      readonly audit: AuditLog;
      readonly clock: Clock;
    },
  ) {}

  execute(sessionId: string): Promise<Result<void, DomainError>> {
    const { context, uow, sessions, audit, clock } = this.deps;
    return uow.run(async () => {
      const current = context.current();
      if (current.actorId === null) {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }
      if (sessionId === current.sessionId) {
        return err(new DomainError('VALIDATION.FAILED', 'Use sign out to close this session'));
      }
      const revoked = await sessions.revokeOfUser(sessionId, current.actorId, clock.now());
      if (!revoked) return err(new DomainError('NOT_FOUND', 'Session not found'));
      await audit.record({
        action: 'auth.session_revoked',
        actorId: current.actorId,
        targetType: 'session',
        targetId: sessionId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
      return ok(undefined);
    });
  }
}
