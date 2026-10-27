/**
 * Invariantes de seguridad
 * - Mensaje y tiempo de respuesta equivalentes para usuario inexistente o contraseña incorrecta:
 *   si no hay hash, se verifica contra uno señuelo para gastar el mismo costo.
 * - Retraso progresivo y bloqueo TEMPORAL por correo (nunca permanente).
 * - La contraseña correcta NO basta: la sesión que se abre queda a medias hasta verificar el segundo factor.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, OrganizationId, Result, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { TenantScope } from '../../organization/index.js';
import type {
  CredentialRepository,
  LoginAttemptStore,
  PasswordHasher,
  PreAuthLookup,
} from './ports/identity-ports.js';
import type { SessionService } from './session-service.js';

export interface LoginCommand {
  readonly email: string;
  readonly password: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export interface LoginOutcome {
  readonly token: string;
  readonly expiresAt: Date;
  readonly status: 'mfa_required' | 'enrollment_required';
}

export interface LoginDeps {
  readonly lookup: PreAuthLookup;
  readonly hasher: PasswordHasher;
  readonly attempts: LoginAttemptStore;
  readonly scope: TenantScope;
  readonly sessions: SessionService;
  readonly credentials: CredentialRepository;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

const invalidCredentials = (): DomainError =>
  new DomainError('AUTH.INVALID_CREDENTIALS', 'Invalid credentials');

export class Login {
  /** Hash señuelo calculado al construir: la primera petición con un correo inexistente no paga de más. */
  private readonly decoyHash: Promise<string>;
  /** Auditorías de intentos fallidos en curso (se hacen fuera del camino de la respuesta). */
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: LoginDeps) {
    this.decoyHash = deps.hasher.hash(`decoy-${String(Math.random())}-${String(Date.now())}`);
  }

  /** Espera las auditorías pendientes (apagado ordenado y pruebas). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async execute(command: LoginCommand): Promise<Result<LoginOutcome, DomainError>> {
    const { lookup, hasher, attempts, scope, sessions, credentials, audit, clock } = this.deps;
    const email = command.email.trim().toLowerCase();
    const key = `login:${email}`;

    const throttle = await attempts.consume(key, clock.now());
    if (!throttle.allowed) {
      return err(
        new DomainError('RATE_LIMITED', 'Too many attempts', {
          retryAfterSeconds: Math.ceil(throttle.retryAfterMs / 1000),
        }),
      );
    }

    const row = await lookup.findLoginByEmail(email);
    const verified =
      row?.argon2Hash === undefined || row.argon2Hash === null
        ? (await hasher.verify(await this.decoyHash, command.password), false)
        : await hasher.verify(row.argon2Hash, command.password);
    const allowedStatus = row?.status === 'active' || row?.status === 'invited';

    if (row === null || !verified || !allowedStatus) {
      // El intento ya quedó contado en `consume`. La auditoría de un usuario conocido se escribe
      // fuera del camino de la respuesta: así un correo existente y uno inexistente tardan lo mismo
      // en fallar (no hay forma de distinguirlos por tiempo), y un fallo del almacén de auditoría
      // no convierte un intento fallido en un 500.
      if (row !== null) this.auditFailureLater(row.organizationId, row.userId, command);
      return err(invalidCredentials());
    }

    await attempts.reset(key);
    const outcome = await scope.runAs(
      { organizationId: row.organizationId, actorId: row.userId, requestId: command.requestId },
      async () => {
        const session = await sessions.issue({
          organizationId: row.organizationId,
          userId: row.userId,
          ip: command.ip,
          userAgent: command.userAgent,
        });
        const factor = await credentials.findTotpFactor(row.userId);
        await audit.record({
          action: 'auth.login_password_verified',
          actorId: row.userId,
          targetType: 'user',
          targetId: row.userId,
          outcome: 'success',
          reasonCode: null,
          ip: command.ip,
          requestId: command.requestId,
          metadata: {},
        });
        return {
          token: session.token,
          expiresAt: session.expiresAt,
          status:
            factor?.verifiedAt === undefined || factor.verifiedAt === null
              ? ('enrollment_required' as const)
              : ('mfa_required' as const),
        };
      },
    );
    return ok(outcome);
  }

  private auditFailureLater(
    organizationId: OrganizationId,
    userId: UserId,
    command: LoginCommand,
  ): void {
    const { scope, audit } = this.deps;
    const task = scope
      .runAs({ organizationId, actorId: null, requestId: command.requestId }, async () => {
        await audit.record({
          action: 'auth.login_failed',
          actorId: null,
          targetType: 'user',
          targetId: userId,
          outcome: 'failure',
          reasonCode: 'AUTH.INVALID_CREDENTIALS',
          ip: command.ip,
          requestId: command.requestId,
          metadata: {},
        });
      })
      .catch(() => {
        // Una auditoría fallida de un intento ya rechazado no debe afectar a quien lo hizo.
      })
      .finally(() => {
        this.pending.delete(task);
      });
    this.pending.add(task);
  }
}
