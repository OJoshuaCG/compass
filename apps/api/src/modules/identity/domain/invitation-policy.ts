/** Invitaciones (plan: "Alta de usuarios"): enlace de un solo uso, vigente 72 horas. */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface InvitationTimes {
  readonly now: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * Vigente solo si no se aceptó, no se revocó y no venció. El llamador responde lo mismo en los tres
 * casos negativos, para no revelar qué le pasó a una invitación (no enumeración).
 */
export const isInvitationLive = (times: InvitationTimes): boolean =>
  times.acceptedAt === null &&
  times.revokedAt === null &&
  times.now.getTime() < times.expiresAt.getTime();

export const invitationExpiry = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + INVITATION_TTL_MS);
