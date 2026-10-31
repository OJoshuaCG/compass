/**
 * Administración de las llaves de acceso propias (registrar, ver, revocar).
 *
 * Invariantes de seguridad
 * - Solo con la sesión completa (segundo factor cumplido) y reautenticación reciente: una sesión
 *   robada no puede añadir su propia llave ni quitar las de la persona.
 * - Solo se listan y revocan llaves de la propia persona; ninguna respuesta incluye la llave
 *   pública ni el identificador de credencial.
 * - Máximo 10 llaves por persona; una credencial ya registrada no se registra dos veces.
 * - Todo cambio escribe su auditoría en la misma transacción.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  KeysetPage,
  KeysetRequest,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import { REAUTH_WINDOW_MS } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type {
  ChallengeStore,
  PasskeyRecord,
  PasskeyRepository,
  WebAuthnEngine,
} from './ports/identity-ports.js';
import { sendSecurityNotice } from './security-notice.js';
import type { SecurityNoticeDeps, SecurityNoticePlan } from './security-notice.js';

export const MAX_PASSKEYS = 10;
const CHALLENGE_MS = 5 * 60 * 1000;

export interface PasskeysDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly directory: UserDirectory;
  readonly passkeys: PasskeyRepository;
  readonly challenges: ChallengeStore;
  readonly webauthn: WebAuthnEngine;
  readonly audit: AuditLog;
  readonly clock: Clock;
  /** Para avisar a la persona de que se agregó o quitó una llave (TODO G5). */
  readonly mailer: Mailer;
  readonly reportLost?: SecurityNoticeDeps['reportLost'];
}

export class Passkeys {
  constructor(private readonly deps: PasskeysDeps) {}

  list(page: KeysetRequest): Promise<KeysetPage<PasskeyRecord>> {
    const { uow, passkeys } = this.deps;
    return uow.run(async () => passkeys.listLivePage(this.actorId(), page));
  }

  beginRegistration(): Promise<Result<{ options: unknown }, DomainError>> {
    const { uow, passkeys, challenges, webauthn, clock } = this.deps;
    return uow.run(async () => {
      this.requireRecentReauth();
      const user = await this.user();
      const existing = await passkeys.listLive(user.id);
      if (existing.length >= MAX_PASSKEYS) {
        return err(new DomainError('VALIDATION.FAILED', 'Too many passkeys'));
      }
      const { options, challenge } = await webauthn.registrationOptions({
        userId: user.id,
        userName: user.email,
        existing: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
      });
      await challenges.issue({
        userId: user.id,
        sessionId: this.sessionId(),
        purpose: 'registration',
        challenge,
        expiresAt: new Date(clock.now().getTime() + CHALLENGE_MS),
      });
      return ok({ options });
    });
  }

  async finishRegistration(input: {
    readonly name: string;
    readonly response: unknown;
  }): Promise<Result<PasskeyRecord, DomainError>> {
    const { context, uow, passkeys, challenges, webauthn, audit, clock } = this.deps;
    const pending: { notice: SecurityNoticePlan | null } = { notice: null };
    const result = await uow.run(async () => {
      this.requireRecentReauth();
      const user = await this.user();
      const now = clock.now();
      const live = await passkeys.listLive(user.id);
      // El tope se vuelve a comprobar aquí: entre pedir las opciones y terminar pudo haber otra alta.
      if (live.length >= MAX_PASSKEYS) {
        return this.refuse(user.id, 'The passkey could not be verified');
      }
      const expected = await challenges.consume(user.id, this.sessionId(), 'registration', now);
      const verified =
        expected === null
          ? null
          : await webauthn.verifyRegistration({
              response: input.response,
              expectedChallenge: expected,
            });
      if (verified === null) return this.refuse(user.id, 'The passkey could not be verified');
      const outcome = await passkeys.insert({
        userId: user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        name: input.name.trim(),
      });
      if (outcome === 'duplicate') return this.refuse(user.id, 'The passkey could not be verified');
      const created = (await passkeys.listLive(user.id)).find(
        (p) => p.credentialId === verified.credentialId,
      );
      if (created === undefined) throw new Error('Passkey was not stored');
      await audit.record({
        action: 'auth.passkey_registered',
        actorId: user.id,
        targetType: 'passkey',
        targetId: created.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: {},
      });
      pending.notice = this.noticePlan('passkey_added', user, now);
      return ok(created);
    });
    // El aviso sale DESPUÉS de confirmar y es de mejor esfuerzo: nunca deshace ni bloquea el alta.
    if (result.ok && pending.notice !== null) await sendSecurityNotice(this.deps, pending.notice);
    return result;
  }

  async revoke(passkeyId: string): Promise<Result<void, DomainError>> {
    const { context, uow, passkeys, audit, clock } = this.deps;
    const pending: { notice: SecurityNoticePlan | null } = { notice: null };
    const result = await uow.run(async () => {
      this.requireRecentReauth();
      const actorId = this.actorId();
      if (!(await passkeys.revoke(passkeyId, actorId, clock.now()))) {
        await this.recordFailure('auth.passkey_revoke_failed', actorId, passkeyId, 'NOT_FOUND');
        return err(new DomainError('NOT_FOUND', 'Passkey not found'));
      }
      await audit.record({
        action: 'auth.passkey_revoked',
        actorId,
        targetType: 'passkey',
        targetId: passkeyId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: {},
      });
      pending.notice = this.noticePlan('passkey_removed', await this.user(), clock.now());
      return ok(undefined);
    });
    if (result.ok && pending.notice !== null) await sendSecurityNotice(this.deps, pending.notice);
    return result;
  }

  // -----------------------------------------------------------------------------------------------

  private noticePlan(
    kind: SecurityNoticePlan['kind'],
    user: { readonly id: UserId; readonly email: string; readonly locale: 'es-MX' | 'en-US' },
    occurredAt: Date,
  ): SecurityNoticePlan {
    return {
      kind,
      userId: user.id,
      to: user.email,
      locale: user.locale,
      occurredAt,
      requestId: this.deps.context.current().requestId,
    };
  }

  private sessionId(): string {
    const { sessionId } = this.deps.context.current();
    if (sessionId === null)
      throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return sessionId;
  }

  /** Una ceremonia fallida se audita y responde igual para cualquier causa (no revela cuál). */
  private async refuse(userId: UserId, message: string): Promise<Result<never, DomainError>> {
    await this.recordFailure('auth.passkey_registration_failed', userId, null, 'VALIDATION.FAILED');
    return err(new DomainError('VALIDATION.FAILED', message));
  }

  private async recordFailure(
    action: string,
    actorId: UserId,
    targetId: string | null,
    reasonCode: string,
  ): Promise<void> {
    await this.deps.audit.record({
      action,
      actorId,
      targetType: 'passkey',
      targetId,
      outcome: 'failure',
      reasonCode,
      ip: null,
      requestId: this.deps.context.current().requestId,
      metadata: {},
    });
  }

  private actorId(): UserId {
    const { actorId } = this.deps.context.current();
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }

  private async user() {
    const user = await this.deps.directory.findById(this.actorId());
    if (user === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return user;
  }

  private requireRecentReauth(): void {
    const { context, clock } = this.deps;
    const reauthAt = context.current().reauthAt;
    if (reauthAt === null || clock.now().getTime() - reauthAt.getTime() > REAUTH_WINDOW_MS) {
      throw new DomainError('AUTHZ.REAUTH_REQUIRED', 'Recent re-authentication required');
    }
  }
}
