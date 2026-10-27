import type { Clock, RequestContextReader } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { SessionRepository } from './ports/identity-ports.js';

/** Cerrar sesión revoca la sesión en el servidor: la cookie robada deja de servir de inmediato. */
export class Logout {
  constructor(
    private readonly deps: {
      readonly context: RequestContextReader;
      readonly uow: UnitOfWork;
      readonly sessions: SessionRepository;
      readonly audit: AuditLog;
      readonly clock: Clock;
    },
  ) {}

  execute(): Promise<void> {
    const { context, uow, sessions, audit, clock } = this.deps;
    return uow.run(async () => {
      const current = context.current();
      if (current.sessionId === null) return;
      await sessions.revoke(current.sessionId, clock.now());
      await audit.record({
        action: 'auth.logout',
        actorId: current.actorId,
        targetType: 'user',
        targetId: current.actorId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });
    });
  }
}
