/**
 * Invariantes de seguridad
 * - El token de sesión tiene 256 bits aleatorios y solo se guarda su SHA-256.
 * - Una sesión inválida (revocada, vencida, inactiva) o de un usuario suspendido o dado de baja
 *   nunca autentica; la causa no se distingue hacia afuera.
 * - Una sesión sin segundo factor verificado (`mfaVerified: false`) solo sirve para completarlo.
 */
import type { Clock, IdGenerator, OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { CryptoPrimitives } from '../../crypto/index.js';
import type { TenantScope } from '../../organization/index.js';
import {
  absoluteExpiry,
  checkSession,
  SESSION_TOUCH_INTERVAL_MS,
} from '../domain/session-policy.js';
import { TOKEN_BYTES, toBase64Url } from '../domain/tokens.js';
import type { PreAuthLookup, SessionRepository } from './ports/identity-ports.js';

/** Quién está del otro lado de una petición autenticada. */
export interface AuthenticatedPrincipal {
  readonly sessionId: string;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly userStatus: 'invited' | 'active';
  readonly mfaVerified: boolean;
  readonly reauthAt: Date | null;
  readonly expiresAt: Date;
}

export interface IssuedSession {
  /** Valor de la cookie; se muestra una sola vez al emitirlo. */
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}

export interface SessionServiceDeps {
  readonly sessions: SessionRepository;
  readonly lookup: PreAuthLookup;
  readonly scope: TenantScope;
  readonly primitives: CryptoPrimitives;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

const encoder = new TextEncoder();

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  hashToken(token: string): Uint8Array {
    return this.deps.primitives.sha256(encoder.encode(token));
  }

  /** Crea la sesión dentro de la transacción en curso (ya con la organización fijada). */
  async issue(input: {
    readonly organizationId: OrganizationId;
    readonly userId: UserId;
    readonly ip: string | null;
    readonly userAgent: string | null;
  }): Promise<IssuedSession> {
    const { sessions, primitives, ids, clock } = this.deps;
    const token = toBase64Url(primitives.randomBytes(TOKEN_BYTES));
    const sessionId = ids.next();
    const now = clock.now();
    const expiresAt = absoluteExpiry(now);
    await sessions.insert({
      id: sessionId,
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash: this.hashToken(token),
      ip: input.ip,
      userAgent: input.userAgent,
      createdAt: now,
      expiresAt,
    });
    return { token, sessionId, expiresAt };
  }

  /** Valida el token de la cookie. Antes de conocer la organización: usa la consulta previa mínima. */
  async authenticate(token: string, requestId: string): Promise<AuthenticatedPrincipal | null> {
    const { lookup, scope, clock } = this.deps;
    if (token === '' || token.length > 200) return null;
    const row = await lookup.findSessionByTokenHash(this.hashToken(token));
    if (row === null) return null;
    if (row.userStatus !== 'active' && row.userStatus !== 'invited') return null;
    const now = clock.now();
    const refusal = checkSession({
      now,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    });
    if (refusal !== null) return null;

    if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await scope.runAs(
        { organizationId: row.organizationId, actorId: row.userId, requestId },
        () => this.deps.sessions.touch(row.sessionId, now),
      );
    }
    return {
      sessionId: row.sessionId,
      organizationId: row.organizationId,
      userId: row.userId,
      userStatus: row.userStatus,
      mfaVerified: row.mfaAt !== null,
      reauthAt: row.reauthAt,
      expiresAt: row.expiresAt,
    };
  }

  /** Cierra la sesión (la transacción en curso debe tener la organización fijada). */
  revoke(sessionId: string): Promise<void> {
    return this.deps.sessions.revoke(sessionId, this.deps.clock.now());
  }
}
