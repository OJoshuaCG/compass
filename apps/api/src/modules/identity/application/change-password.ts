/**
 * Invariantes de seguridad
 * - Pide la contraseña ACTUAL: una sesión robada no basta para cambiarla.
 * - La nueva cumple la misma política que al aceptar una invitación y debe ser distinta de la actual.
 * - Intentos contados de forma atómica con bloqueo temporal (mismo control que el segundo factor).
 * - Al cambiarla se cierran las demás sesiones de la persona: quien tuviera la contraseña vieja pierde el acceso.
 * - Todas las validaciones ocurren ANTES de escribir; un rechazo no deja cambios a medias.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { evaluatePassword, personalTokens } from '../domain/password-policy.js';
import type {
  CredentialRepository,
  LoginAttemptStore,
  PasswordHasher,
  PasswordStrength,
  SessionRepository,
} from './ports/identity-ports.js';

export interface ChangePasswordDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly directory: UserDirectory;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly strength: PasswordStrength;
  readonly attempts: LoginAttemptStore;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export class ChangePassword {
  constructor(private readonly deps: ChangePasswordDeps) {}

  execute(input: {
    readonly currentPassword: string;
    readonly newPassword: string;
    /** ¿La sesión ya verificó el segundo factor? Sin él, solo se cambia la contraseña inicial obligatoria. */
    readonly mfaVerified: boolean;
  }): Promise<Result<void, DomainError>> {
    const {
      context,
      uow,
      directory,
      credentials,
      sessions,
      hasher,
      strength,
      attempts,
      audit,
      clock,
    } = this.deps;
    return uow.run(async () => {
      const current = context.current();
      if (current.actorId === null || current.sessionId === null) {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }
      const user = await directory.findById(current.actorId);
      const stored = await credentials.findPassword(current.actorId);
      if (user === null || stored === null) {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }

      // Una sesión a medias (solo contraseña) únicamente puede cambiar la contraseña inicial de un solo
      // uso; con una contraseña vigente, quien solo la conoce podría dejar fuera a su dueña.
      if (!input.mfaVerified && !stored.mustChange) {
        throw new DomainError('AUTH.MFA_REQUIRED', 'Second factor required');
      }

      const key = `pwd:${user.id}`;
      const throttle = await attempts.consume(key, clock.now());
      if (!throttle.allowed) {
        return err(
          new DomainError('RATE_LIMITED', 'Too many attempts', {
            retryAfterSeconds: Math.ceil(throttle.retryAfterMs / 1000),
          }),
        );
      }

      const event = (
        outcome: 'success' | 'failure',
        action: string,
        reasonCode: string | null,
      ) => ({
        action,
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        outcome,
        reasonCode,
        ip: null,
        requestId: current.requestId,
        metadata: {},
      });

      if (!(await hasher.verify(stored.hash, input.currentPassword))) {
        await audit.record(
          event('failure', 'auth.password_change_failed', 'AUTH.INVALID_CREDENTIALS'),
        );
        return err(new DomainError('AUTH.INVALID_CREDENTIALS', 'Invalid credentials'));
      }

      // Conocer la contraseña actual ya quedó demostrado: lo que sigue (política, reutilización) no es
      // un fallo de autenticación y no debe acercar a la persona al bloqueo.
      await attempts.reset(key);

      const tokens = personalTokens(user.email, user.displayName);
      const problem = evaluatePassword({
        password: input.newPassword,
        score: strength.score(input.newPassword, tokens),
        personalTokens: tokens,
      });
      if (problem !== null) return err(new DomainError('PASSWORD.WEAK', 'Password is too weak'));
      if (await hasher.verify(stored.hash, input.newPassword)) {
        return err(new DomainError('PASSWORD.REUSED', 'The new password must differ'));
      }

      await credentials.savePassword(user.id, await hasher.hash(input.newPassword), false);
      await sessions.revokeOthersOfUser(user.id, current.sessionId, clock.now());
      await audit.record(event('success', 'auth.password_changed', null));
      return ok(undefined);
    });
  }
}
