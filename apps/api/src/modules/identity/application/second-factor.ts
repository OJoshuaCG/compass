/**
 * Invariantes de seguridad
 * - Solo se registra un segundo factor si el usuario NO tiene uno verificado: de lo contrario,
 *   quien conociera la contraseña podría registrar el suyo y saltarse el MFA.
 * - El secreto TOTP se guarda cifrado (SecretCipher) y solo se muestra al registrarlo.
 * - Un código TOTP no se puede reutilizar (se exige un paso de tiempo mayor al último aceptado).
 * - Los códigos de recuperación se guardan como SHA-256 y se consumen una sola vez.
 * - Intentos fallidos: retraso progresivo y bloqueo temporal por usuario.
 * - Toda verificación que cambia el estado del segundo factor de la sesión rota su token en la misma
 *   transacción y lo devuelve: quien conociera el token de antes de la elevación no lo conserva.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { CryptoPrimitives, SecretCipher, SecretContext } from '../../crypto/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { totpSecretContext } from '../domain/totp-secret-context.js';
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
  ChallengeStore,
  PasskeyRepository,
  TotpFactorRecord,
  WebAuthnEngine,
} from './ports/identity-ports.js';
import { sendSecurityNotice } from './security-notice.js';
import type { SecurityNoticeDeps, SecurityNoticePlan } from './security-notice.js';

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
  /** Para avisar a los Administradores cuando se usa un código de emergencia. */
  readonly mailer: Mailer;
  readonly reportLost?: SecurityNoticeDeps['reportLost'];
  readonly passkeys: PasskeyRepository;
  readonly challenges: ChallengeStore;
  readonly webauthn: WebAuthnEngine;
  /** Rota el token de la sesión al cumplir el segundo factor (fijación de sesión, TODO A2). */
  readonly tokens: SessionTokenRotator;
}

export interface SessionTokenRotator {
  rotateToken(sessionId: string): Promise<string>;
}

/** Valor de la cookie nueva: se muestra una sola vez, igual que al iniciar sesión. */
export interface RotatedSession {
  readonly sessionToken: string;
}

/** Vigencia del desafío de una ceremonia WebAuthn. */
const PASSKEY_CHALLENGE_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type AdminContact = { readonly email: string; readonly locale: 'es-MX' | 'en-US' };

const mfaInvalid = (): DomainError => new DomainError('AUTH.MFA_INVALID', 'Invalid code');

/** Un fallo al pedir o verificar la reautenticación no se confunde con uno de inicio de sesión. */
const failureAction = (
  purpose: 'authentication' | 'reauthentication',
): 'auth.mfa_failed' | 'auth.reauth_failed' =>
  purpose === 'reauthentication' ? 'auth.reauth_failed' : 'auth.mfa_failed';

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
  confirmTotpEnrollment(
    code: string,
  ): Promise<Result<RotatedSession & { recoveryCodes: string[] }, DomainError>> {
    const { uow, directory, credentials, sessions, tokens, primitives, audit, clock } = this.deps;
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
      const sessionToken = await tokens.rotateToken(sessionId);
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.totp_enrolled', 'success', user.id, requestId));
      return ok({ recoveryCodes, sessionToken });
    });
  }

  /** Completa el inicio de sesión con el código del autenticador. */
  verifyTotp(code: string): Promise<Result<RotatedSession, DomainError>> {
    const { uow, credentials, sessions, tokens, audit, clock } = this.deps;
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
      const sessionToken = await tokens.rotateToken(sessionId);
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.mfa_verified', 'success', user.id, requestId));
      return ok({ sessionToken });
    });
  }

  /**
   * Último recurso: un código de recuperación de un solo uso.
   *
   * Un código de EMERGENCIA (los de la Raíz, custodiados fuera del sistema) hace más: deja a la
   * persona sin segundo factor y de vuelta en el alta del 2FA, cierra sus otras sesiones, queda como
   * evento crítico y avisa a los Administradores. No concede una sesión completa: hay que registrar
   * un factor nuevo. Sigue exigiendo la contraseña (esta ruta solo acepta una sesión a medias).
   */
  async verifyRecoveryCode(code: string): Promise<Result<RotatedSession, DomainError>> {
    const { uow } = this.deps;
    const outcome = await uow.run(() => this.consumeRecoveryCode(code));
    if (!outcome.ok) return err(outcome.error);
    // El aviso sale DESPUÉS de confirmar: no retiene la transacción ni anuncia un restablecimiento
    // que no llegó a ocurrir.
    if (outcome.value.alert !== null) {
      try {
        await this.alertAdministrators(outcome.value.alert);
      } catch {
        // El token ya rotó y el restablecimiento ya se confirmó: si el aviso falla, la persona debe
        // recibir igualmente su cookie nueva o quedaría fuera con el código ya consumido.
      }
    }
    // Un código ordinario no avisa a los Administradores, pero la persona sí debe enterarse (TODO G5):
    // si alguien más lo usó, es la única señal que tiene. `sendSecurityNotice` nunca lanza.
    if (outcome.value.notice !== null) {
      await sendSecurityNotice(this.deps, outcome.value.notice);
    }
    return ok({ sessionToken: outcome.value.sessionToken });
  }

  private async consumeRecoveryCode(code: string): Promise<
    Result<
      {
        sessionToken: string;
        alert: { requestId: string; usedAt: Date; recipients: readonly AdminContact[] } | null;
        notice: SecurityNoticePlan | null;
      },
      DomainError
    >
  > {
    const { directory, credentials, sessions, tokens, primitives, audit, clock } = this.deps;
    const { user, sessionId, requestId } = await this.currentUser();
    const blocked = await this.checkThrottle(user.id);
    if (blocked !== null) return err(blocked);
    const hash = primitives.sha256(encoder.encode(normalizeRecoveryCode(code)));
    const now = clock.now();
    const kind = await credentials.consumeRecoveryCode(user.id, hash, now);
    if (kind === null) return this.failed(user.id, requestId);

    await this.clearFailures(user.id);
    if (kind === 'recovery') {
      await sessions.setMfa(sessionId, now);
      const sessionToken = await tokens.rotateToken(sessionId);
      await audit.record(this.event('auth.recovery_code_used', 'success', user.id, requestId));
      return ok({
        sessionToken,
        alert: null,
        notice: {
          kind: 'recovery_code_used',
          userId: user.id,
          to: user.email,
          locale: user.locale,
          occurredAt: now,
          requestId,
        },
      });
    }
    // Código de emergencia: la persona queda sin factor y de vuelta en el alta del 2FA, también en la
    // sesión que lo usó (aunque ya estuviera completa).
    await credentials.revokeSecondFactor(user.id, now);
    await directory.setStatus(user.id, 'invited');
    await sessions.revokeOthersOfUser(user.id, sessionId, now);
    await sessions.clearMfa(sessionId);
    // También rota: la sesión cambia de estado de seguridad y el token anterior no debe sobrevivirlo.
    const sessionToken = await tokens.rotateToken(sessionId);
    const recipients = await directory.listAdministratorContacts();
    await audit.record({
      ...this.event('auth.emergency_code_used', 'success', user.id, requestId),
      metadata: { alertRecipients: recipients.length },
    });
    return ok({ sessionToken, alert: { requestId, usedAt: now, recipients }, notice: null });
  }

  /**
   * Inicio de sesión con llave de acceso, paso 1: el desafío y las llaves que la persona puede usar.
   * Sin llaves registradas responde igual que un fallo, para no revelar si las tiene.
   */
  beginPasskeyLogin(): Promise<Result<{ options: unknown }, DomainError>> {
    return this.beginPasskeyCeremony('authentication');
  }

  /** Reautenticación con llave de acceso, paso 1 (ADR 0033): desafío con su propia finalidad. */
  beginPasskeyReauthentication(): Promise<Result<{ options: unknown }, DomainError>> {
    return this.beginPasskeyCeremony('reauthentication');
  }

  /** Paso 2: verifica la firma de la llave (con verificación de la persona) y cumple el segundo factor. */
  verifyPasskey(response: unknown): Promise<Result<RotatedSession, DomainError>> {
    const { uow, sessions, tokens, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);
      const now = clock.now();
      if (!(await this.verifyPasskeyAssertion(user.id, sessionId, 'authentication', response))) {
        return this.failed(user.id, requestId);
      }
      await sessions.setMfa(sessionId, now);
      const sessionToken = await tokens.rotateToken(sessionId);
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.passkey_login', 'success', user.id, requestId));
      return ok({ sessionToken });
    });
  }

  /**
   * Reautenticación con llave de acceso, paso 2 (ADR 0033): misma verificación que el inicio de sesión
   * (firma, verificación de la persona y contador) pero con desafío propio, y solo renueva la ventana
   * de reautenticación. Nunca acepta códigos de recuperación ni de emergencia.
   */
  reauthenticateWithPasskey(response: unknown): Promise<Result<void, DomainError>> {
    const { uow, sessions, audit, clock } = this.deps;
    return uow.run(async () => {
      const { user, sessionId, requestId } = await this.currentUser();
      const blocked = await this.checkThrottle(user.id);
      if (blocked !== null) return err(blocked);
      if (!(await this.verifyPasskeyAssertion(user.id, sessionId, 'reauthentication', response))) {
        return this.failed(user.id, requestId, 'auth.reauth_failed');
      }
      await sessions.setReauth(sessionId, clock.now());
      await this.clearFailures(user.id);
      await audit.record(this.event('auth.reauthenticated_passkey', 'success', user.id, requestId));
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

  /**
   * Emite el desafío WebAuthn de una ceremonia de autenticación. Sin llaves registradas responde igual
   * que un fallo, para no revelar si la persona las tiene.
   */
  private beginPasskeyCeremony(
    purpose: 'authentication' | 'reauthentication',
  ): Promise<Result<{ options: unknown }, DomainError>> {
    const { uow, passkeys, challenges, webauthn, clock } = this.deps;
    return uow.run(async () => {
      const { user, sessionId, requestId } = await this.currentUser();
      // Pedir el desafío no cuenta como intento (solo la verificación): el límite por IP ya acota
      // cuántos se piden, y quien falla al verificar queda frenado por el contador de la persona.
      const live = await passkeys.listLive(user.id);
      if (live.length === 0) return this.failed(user.id, requestId, failureAction(purpose));
      const { options, challenge } = await webauthn.authenticationOptions({
        allowed: live.map((p) => ({ id: p.credentialId, transports: p.transports })),
      });
      await challenges.issue({
        userId: user.id,
        sessionId,
        purpose,
        challenge,
        expiresAt: new Date(clock.now().getTime() + PASSKEY_CHALLENGE_MS),
      });
      return ok({ options });
    });
  }

  /**
   * Consume el desafío de esa finalidad y verifica la firma con verificación de la persona. Un contador
   * que no avanza indica un clon o una repetición: se rechaza como cualquier otro fallo.
   */
  private async verifyPasskeyAssertion(
    userId: UserId,
    sessionId: string,
    purpose: 'authentication' | 'reauthentication',
    response: unknown,
  ): Promise<boolean> {
    const { passkeys, challenges, webauthn, clock } = this.deps;
    const now = clock.now();
    const expected = await challenges.consume(userId, sessionId, purpose, now);
    const presented = (response as { id?: unknown }).id;
    const credential =
      typeof presented === 'string'
        ? (await passkeys.listLive(userId)).find((p) => p.credentialId === presented)
        : undefined;
    if (expected === null || credential === undefined) return false;
    const verified = await webauthn.verifyAuthentication({
      response,
      expectedChallenge: expected,
      credential,
    });
    if (verified === null) return false;
    return passkeys.recordUse(credential.id, verified.newCounter, now);
  }

  /**
   * Mejor esfuerzo, ya confirmado el restablecimiento: un fallo del correo no debe dejar a la Raíz sin
   * poder recuperarse. Si no hay destinatarios o alguno falla, queda registrado en la auditoría.
   */
  private async alertAdministrators(plan: {
    readonly requestId: string;
    readonly usedAt: Date;
    readonly recipients: readonly AdminContact[];
  }): Promise<void> {
    const { uow, mailer, audit, context } = this.deps;
    const results = await Promise.allSettled(
      plan.recipients.map((admin) =>
        mailer.sendEmergencyAlert({ to: admin.email, locale: admin.locale, usedAt: plan.usedAt }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (plan.recipients.length > 0 && failed === 0) return;
    const actorId = context.current().actorId;
    await uow.run(() =>
      audit.record({
        action: 'auth.emergency_alert_incomplete',
        actorId,
        targetType: 'user',
        targetId: actorId,
        outcome: 'failure',
        reasonCode: null,
        ip: null,
        requestId: plan.requestId,
        metadata: { recipients: plan.recipients.length, failed },
      }),
    );
  }

  private async currentUser() {
    const { context, directory } = this.deps;
    const current = context.current();
    if (current.actorId === null || current.sessionId === null) {
      throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    }
    const user = await directory.findById(current.actorId);
    if (user === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    // Con la contraseña inicial sin cambiar no se registra ni se verifica el segundo factor: quien
    // solo conoce esa contraseña no puede quedarse con el acceso registrando su propio factor.
    const password = await this.deps.credentials.findPassword(user.id);
    if (password?.mustChange === true) {
      throw new DomainError('AUTH.PASSWORD_CHANGE_REQUIRED', 'Change your initial password first');
    }
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
    return totpSecretContext(organizationId, userId);
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

  /**
   * Código incorrecto: se cuenta el fallo, se audita y se responde lo mismo siempre. La reautenticación
   * con llave de acceso usa su propia acción para distinguirla de un fallo de inicio de sesión.
   */
  private async failed(
    userId: UserId,
    requestId: string,
    action: 'auth.mfa_failed' | 'auth.reauth_failed' = 'auth.mfa_failed',
  ): Promise<Result<never, DomainError>> {
    const { audit } = this.deps;
    await audit.record(this.event(action, 'failure', userId, requestId, 'AUTH.MFA_INVALID'));
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
