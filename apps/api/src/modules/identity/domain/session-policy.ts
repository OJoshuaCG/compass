/**
 * Sesiones (plan: "Sesiones"): caducan por inactividad a los 30 minutos y de forma absoluta a las
 * 12 horas (configurables por organización más adelante). Una sesión revocada nunca vuelve a valer.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Cada cuánto se actualiza `last_seen_at`: evita una escritura por cada petición. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

export interface SessionTimes {
  readonly now: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export type SessionRefusal = 'REVOKED' | 'EXPIRED' | 'IDLE';

export function checkSession(times: SessionTimes): SessionRefusal | null {
  if (times.revokedAt !== null) return 'REVOKED';
  if (times.now.getTime() >= times.expiresAt.getTime()) return 'EXPIRED';
  if (times.now.getTime() - times.lastSeenAt.getTime() >= SESSION_IDLE_MS) return 'IDLE';
  return null;
}

export const absoluteExpiry = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + SESSION_ABSOLUTE_MS);
