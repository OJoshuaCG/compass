/**
 * Invariantes de seguridad
 * - Solo se registra un segundo factor si el usuario NO tiene uno verificado: de lo contrario,
 *   quien conociera la contraseña podría registrar el suyo y saltarse el MFA.
 * - El secreto TOTP se guarda cifrado (SecretCipher) y solo se muestra al registrarlo.
 * - Un código TOTP no se puede reutilizar (se exige un paso de tiempo mayor al último aceptado).
 * - Los códigos de recuperación se guardan como SHA-256 y se consumen una sola vez.
 * - Intentos fallidos: retraso progresivo y bloqueo temporal por usuario.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { CryptoPrimitives, SecretCipher, SecretContext } from '../../crypto/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_RANDOM_BYTES,
} from '../domain/recovery-codes.js';
import type {
  CredentialRepository,
  LoginAttemptStore,
  SessionRepository,
  TotpEngine,
  TotpFactorRecord,
} from './ports/identity-ports.js';

export interface SecondFactorDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly directory: UserDirectory;
  readonly credentials: CredentialRepository;
  readonly sessions: SessionRepository;
  readonly cipher: SecretCipher;
  readonly totp: TotpEngine;
  readonly primitives: CryptoPrimitives;
  readonly attempts: LoginAttemptStore;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const mfaInvalid = (): DomainError => new DomainError('AUTH.MFA_INVALID', 'Invalid code');

export class SecondFactor {
  constructor(private readonly deps: SecondFactorDeps) {}

  /** Paso 1 del alta del 2FA: genera el secreto y lo guarda cifrado, sin verificar. */
  beginTotpEnrollment(): Promise<Result<{ secret: string; otpauthUri: string }, DomainError>> {
    const { uow, credentials, cipher, totp } = this.deps;
    return uow.run(async () => {
      const { user, organizationId } = await this.currentUser();
      const existing = await credentials.findTotpFactor(user.id);
      if (existing?.verifiedAt !== undefined && existing.verifiedAt !== null)
        return err(new DomainError('AUTH.MFA_REQUIRED', 'Second factor already registered'));

      const secret = totp.generateSecret();
      const sealed = await cipher.encrypt(
        this.secretContext(organizationId, user.id),
        encoder.encode(secret),
      );
      if (!sealed.ok) return err(sealed.error);
      await credentials.saveUnverifiedTotpFactor({
        userId: user.id,
        ciphertext: sealed.value.ciphertext,
        nonce: sealed.value.nonce,
        dekVersion: sealed.value.dekVersion,
      });
      return ok({ secret, otpauthUri: totp.uri({ secret, accountLabel: user.email }) });
    });
  }

  /**
   * Paso 2: el usuario escribe el código que ve en su autenticador. Si es correcto, el factor queda
   * verificado, el usuario pasa a activo, se emiten los códigos de recuperación (una sola vez) y
   * la sesión queda con el segundo factor cumplido.
   */
  confirmTotpEnrollment(code: string): Promise<Result<{ recoveryCodes: string[] }, DomainError>> {
    const { uow, directory, credentials, sessions, primitives, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, organizationId, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);

      const factor = await credentials.findTotpFactor(user.id);
      if (factor === null || factor.verifiedAt !== null) {
        return err(new DomainError('AUTH.ENROLLMENT_REQUIRED', 'No pending enrollment'));
      }
      const checked = await this.checkCode(organizationId, user.id, factor, code);
      if (!checked.ok) return err(checked.error);
      if (checked.value === null) return this.failed(user.id, requestId);

      const now = clock.now();
      await credentials.markTotpVerified(factor.id, now, checked.value);
      const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
        formatRecoveryCode(primitives.randomBytes(RECOVERY_CODE_RANDOM_BYTES)),
      );
      await credentials.replaceRecoveryCodes(
        user.id,
        recoveryCodes.map((c) => primitives.sha256(encoder.encode(normalizeRecoveryCode(c)))),
      );
      if (user.status === 'invited') await directory.setStatus(user.id, 'active');
      await sessions.setMfa(sessionId, now);
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.totp_enrolled', 'success', user.id, requestId));
      return ok({ recoveryCodes });
    });
  }

  /** Completa el inicio de sesión con el código del autenticador. */
  verifyTotp(code: string): Promise<Result<void, DomainError>> {
    const { uow, credentials, sessions, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, organizationId, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);
      const factor = await credentials.findTotpFactor(user.id);
      if (factor?.verifiedAt === undefined || factor.verifiedAt === null) {
        return err(new DomainError('AUTH.ENROLLMENT_REQUIRED', 'No second factor registered'));
      }
      const checked = await this.checkCode(organizationId, user.id, factor, code);
      if (!checked.ok) return err(checked.error);
      if (checked.value === null) return this.failed(user.id, requestId);

      await sessions.setMfa(sessionId, clock.now());
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.mfa_verified', 'success', user.id, requestId));
      return ok(undefined);
    });
  }

  /** Último recurso: un código de recuperación de un solo uso. */
  verifyRecoveryCode(code: string): Promise<Result<void, DomainError>> {
    const { uow, credentials, sessions, primitives, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);
      const hash = primitives.sha256(encoder.encode(normalizeRecoveryCode(code)));
      const consumed = await credentials.consumeRecoveryCode(user.id, hash, clock.now());
      if (!consumed) return this.failed(user.id, requestId);

      await sessions.setMfa(sessionId, clock.now());
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.recovery_code_used', 'success', user.id, requestId));
      return ok(undefined);
    });
  }

  /** Reautenticación (step-up): un factor verificado en los últimos 5 minutos habilita acciones sensibles. */
  reauthenticate(code: string): Promise<Result<void, DomainError>> {
    const { uow, credentials, sessions, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, organizationId, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);
      const factor = await credentials.findTotpFactor(user.id);
      if (factor?.verifiedAt === undefined || factor.verifiedAt === null) {
        return err(new DomainError('AUTH.ENROLLMENT_REQUIRED', 'No second factor registered'));
      }
      const checked = await this.checkCode(organizationId, user.id, factor, code);
      if (!checked.ok) return err(checked.error);
      if (checked.value === null) return this.failed(user.id, requestId);

      await sessions.setReauth(sessionId, clock.now());
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.reauthenticated', 'success', user.id, requestId));
      return ok(undefined);
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async currentUser() {
    const { context, directory } = this.deps;
    const current = context.current();
    if (current.actorId === null || current.sessionId === null) {
      throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    }
    const user = await directory.findById(current.actorId);
    if (user === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return {
      user,
      organizationId: current.organizationId,
      sessionId: current.sessionId,
      requestId: current.requestId,
    };
  }

  private secretContext(
    organizationId: SecretContext['organizationId'],
    userId: UserId,
  ): SecretContext {
    return { organizationId, resourceId: userId, field: 'totp_secret', version: 1 };
  }

  /**
   * Devuelve el paso del código aceptado, o `null` si es incorrecto o ya se usó. Un código
   * reutilizado cuenta como incorrecto.
   */
  private async checkCode(
    organizationId: SecretContext['organizationId'],
    userId: UserId,
    factor: TotpFactorRecord,
    code: string,
  ): Promise<Result<number | null, DomainError>> {
    const { cipher, totp, credentials, clock } = this.deps;
    const opened = await cipher.decrypt(this.secretContext(organizationId, userId), {
      ciphertext: factor.ciphertext,
      nonce: factor.nonce,
      dekVersion: factor.dekVersion,
    });
    if (!opened.ok) return err(opened.error);
    const secret = decoder.decode(opened.value);
    opened.value.fill(0);

    const verification = totp.verify(secret, code, clock.now());
    if (!verification.valid) return ok(null);
    if (factor.verifiedAt === null) return ok(verification.step); // el alta registra el paso al verificar
    const fresh = await credentials.advanceTotpStep(factor.id, verification.step);
    return ok(fresh ? verification.step : null);
  }

  /** Cuenta el intento y decide en una sola operación (ver `LoginAttemptStore`). */
  private async checkThrottle(userId: UserId): Promise<DomainError | null> {
    const { attempts, clock } = this.deps;
    const status = await attempts.consume(`mfa:${userId}`, clock.now());
    if (status.allowed) return null;
    return new DomainError('RATE_LIMITED', 'Too many attempts', {
      retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000),
    });
  }

  private clearFailures(userId: UserId): Promise<void> {
    return this.deps.attempts.reset(`mfa:${userId}`);
  }

  /** Código incorrecto: se cuenta el fallo, se audita y se responde lo mismo siempre. */
  private async failed(userId: UserId, requestId: string): Promise<Result<never, DomainError>> {
    const { audit } = this.deps;
    await audit.record(
      this.event('auth.mfa_failed', 'failure', userId, requestId, 'AUTH.MFA_INVALID'),
    );
    return err(mfaInvalid());
  }

  private event(
    action: string,
    outcome: 'success' | 'failure',
    userId: UserId,
    requestId: string,
    reasonCode: string | null = null,
  ) {
    return {
      action,
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      outcome,
      reasonCode,
      ip: null,
      requestId,
      metadata: {},
    } as const;
  }
}
