import type { OrganizationId, Rank, UserId } from '../../../../shared/kernel/index.js';
import type { ThrottleStatus } from '../../domain/throttle-policy.js';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

/** Puntaje de fortaleza 0 a 4 (zxcvbn). */
export interface PasswordStrength {
  score(password: string, userInputs: readonly string[]): number;
}

export interface TotpVerification {
  readonly valid: boolean;
  /** Paso de tiempo del código aceptado; sirve para impedir su reutilización. */
  readonly step: number;
}

export interface TotpEngine {
  generateSecret(): string;
  uri(input: { readonly secret: string; readonly accountLabel: string }): string;
  verify(secret: string, code: string, now: Date): TotpVerification;
}

export interface SessionRecord {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly mfaAt: Date | null;
  readonly reauthAt: Date | null;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** Lo que se muestra de una sesión viva a su dueña; nunca el token ni su hash. */
export interface SessionListing {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export interface NewSession {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly tokenHash: Uint8Array;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Instante de creación según el reloj de la aplicación: también es la primera "última actividad". */
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface SessionRepository {
  insert(session: NewSession): Promise<void>;
  setMfa(sessionId: string, at: Date): Promise<void>;
  setReauth(sessionId: string, at: Date): Promise<void>;
  /** Devuelve la sesión a medias: quita el segundo factor y la reautenticación (p. ej. tras un restablecimiento). */
  clearMfa(sessionId: string): Promise<void>;
  touch(sessionId: string, at: Date): Promise<void>;
  revoke(sessionId: string, at: Date): Promise<void>;
  revokeAllOfUser(userId: UserId, at: Date): Promise<void>;
  /** Sesiones vivas de la persona: sin revocar, sin vencer y con actividad posterior a `idleSince`. */
  listLiveOfUser(userId: UserId, now: Date, idleSince: Date): Promise<readonly SessionListing[]>;
  /** Cierra una sesión solo si es de esa persona; `false` si no existe, no es suya o ya estaba cerrada. */
  revokeOfUser(sessionId: string, userId: UserId, at: Date): Promise<boolean>;
  /** Cierra todas las sesiones de la persona salvo la indicada (por ejemplo, tras cambiar su contraseña). */
  revokeOthersOfUser(userId: UserId, exceptSessionId: string, at: Date): Promise<void>;
}

export interface NewInvitation {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly rank: Rank;
  readonly invitedBy: UserId;
  readonly managedBy: UserId;
  readonly roleIds: readonly string[];
  readonly tokenHash: Uint8Array;
  readonly expiresAt: Date;
}

export interface InvitationRecord {
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly rank: Rank;
  readonly invitedBy: UserId;
  readonly managedBy: UserId;
  readonly roleIds: readonly string[];
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface PendingInvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly rank: Rank;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface InvitationRepository {
  /** Devuelve `conflict` si ya hay una invitación pendiente para ese correo en la organización. */
  insert(invitation: NewInvitation): Promise<'inserted' | 'conflict'>;
  /** Revoca las invitaciones pendientes de ese correo que ya vencieron, para poder volver a invitar. */
  revokeExpiredForEmail(email: string, now: Date): Promise<void>;
  /** Bloquea la fila hasta el fin de la transacción: dos aceptaciones simultáneas no pasan ambas. */
  findByIdForUpdate(id: string): Promise<InvitationRecord | null>;
  markAccepted(id: string, at: Date): Promise<void>;
  /** Invitaciones sin aceptar ni revocar; `invitedBy` las limita a las de una persona (la Raíz ve todas). */
  listPending(invitedBy: UserId | null): Promise<readonly PendingInvitationRecord[]>;
  revoke(id: string, at: Date): Promise<void>;
  revokePendingOfUser(userId: UserId, at: Date): Promise<void>;
}

export interface TotpFactorRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
  readonly verifiedAt: Date | null;
  readonly lastUsedStep: number | null;
}

export interface CredentialRepository {
  savePassword(userId: UserId, argon2Hash: string, mustChange: boolean): Promise<void>;
  findPassword(
    userId: UserId,
  ): Promise<{ readonly hash: string; readonly mustChange: boolean } | null>;
  findTotpFactor(userId: UserId): Promise<TotpFactorRecord | null>;
  /** Reemplaza cualquier factor aún no verificado por uno nuevo. */
  saveUnverifiedTotpFactor(input: {
    readonly userId: UserId;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<void>;
  markTotpVerified(factorId: string, at: Date, step: number): Promise<void>;
  /** Registra el paso solo si es mayor al último aceptado; `false` indica un código reutilizado. */
  advanceTotpStep(factorId: string, step: number): Promise<boolean>;
  replaceRecoveryCodes(userId: UserId, hashes: readonly Uint8Array[]): Promise<void>;
  /** Marca el código como usado de forma atómica; `false` si no existe o ya se usó. */
  /** Consume un código vigente de la persona y dice de qué clase era; `null` si no existe o ya se usó. */
  consumeRecoveryCode(
    userId: UserId,
    hash: Uint8Array,
    at: Date,
  ): Promise<'recovery' | 'emergency' | null>;
  /**
   * Deja a la persona sin segundo factor registrado: revoca el TOTP y los códigos de recuperación
   * ordinarios. Los códigos de emergencia no se tocan (siguen custodiados fuera del sistema).
   */
  revokeSecondFactor(userId: UserId, at: Date): Promise<void>;
}

export interface LoginRow {
  readonly userId: UserId;
  readonly organizationId: OrganizationId;
  readonly status: 'invited' | 'active' | 'suspended' | 'deactivated';
  readonly argon2Hash: string | null;
  /** La contraseña es de un solo uso (la inicial de la Raíz): debe cambiarse antes de seguir. */
  readonly mustChange: boolean;
}

export interface PreAuthInvitation {
  readonly invitationId: string;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly rank: Rank;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface PreAuthSession {
  readonly sessionId: string;
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  readonly userStatus: LoginRow['status'];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly mfaAt: Date | null;
  readonly reauthAt: Date | null;
  readonly lastSeenAt: Date;
}

/**
 * Consultas ANTES de conocer la organización (login, invitación, sesión). Usan las funciones
 * mínimas del esquema `auth` y no abren transacción con organización (ADR 0021).
 */
export interface PreAuthLookup {
  findLoginByEmail(email: string): Promise<LoginRow | null>;
  findInvitationByTokenHash(tokenHash: Uint8Array): Promise<PreAuthInvitation | null>;
  findSessionByTokenHash(tokenHash: Uint8Array): Promise<PreAuthSession | null>;
}

/**
 * Control de intentos. `consume` decide y cuenta el intento en UNA sola operación: si fueran dos
 * pasos (leer, luego anotar el fallo), una ráfaga de intentos en paralelo pasaría todos antes de que
 * el primero quedara contado. Un intento correcto llama a `reset`.
 */
export interface LoginAttemptStore {
  consume(key: string, at: Date): Promise<ThrottleStatus>;
  reset(key: string): Promise<void>;
}
