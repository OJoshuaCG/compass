import type { Passkey, PendingInvitation, SessionSummary } from '@iam/contracts';

/** Una invitación "por vencer" es la que caduca en menos de este margen. */
export const EXPIRING_SOON_MS = 24 * 60 * 60 * 1000;

/** Tope de elementos en "Requiere tu atención": el resto se ve en su pantalla. */
export const ATTENTION_LIMIT = 5;

export type AttentionItem =
  | { kind: 'invitationExpired'; id: string; email: string }
  | { kind: 'invitationExpiring'; id: string; email: string; expiresAt: string }
  | { kind: 'noPasskey' }
  | { kind: 'otherSessions'; count: number };

export type AttentionInput = {
  /** `undefined` si aún no llegó o si la persona no puede ver invitaciones. */
  invitations: PendingInvitation[] | undefined;
  passkeys: Passkey[] | undefined;
  sessions: SessionSummary[] | undefined;
  now: Date;
};

/**
 * Pendientes que merecen una acción, del más urgente al menos urgente: invitaciones vencidas,
 * invitaciones por vencer, ninguna llave de acceso registrada y sesiones abiertas en otros
 * dispositivos. Una fuente sin datos no aporta elementos (no se inventa un estado).
 */
export function buildAttention({
  invitations,
  passkeys,
  sessions,
  now,
}: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const limit = now.getTime() + EXPIRING_SOON_MS;

  for (const invitation of invitations ?? []) {
    if (invitation.expired) {
      items.push({ kind: 'invitationExpired', id: invitation.id, email: invitation.email });
    }
  }
  for (const invitation of invitations ?? []) {
    if (!invitation.expired && Date.parse(invitation.expiresAt) <= limit) {
      items.push({
        kind: 'invitationExpiring',
        id: invitation.id,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
      });
    }
  }
  if (passkeys !== undefined && passkeys.length === 0) items.push({ kind: 'noPasskey' });
  const others = sessions?.filter((session) => !session.current).length ?? 0;
  if (others > 0) items.push({ kind: 'otherSessions', count: others });

  return items.slice(0, ATTENTION_LIMIT);
}

/** Invitaciones que siguen vigentes y las que ya vencieron (para la tarjeta de métricas). */
export function countInvitations(invitations: PendingInvitation[]): {
  pending: number;
  expired: number;
} {
  const expired = invitations.filter((invitation) => invitation.expired).length;
  return { pending: invitations.length - expired, expired };
}
