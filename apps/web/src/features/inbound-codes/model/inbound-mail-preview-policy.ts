import type { INBOUND_MAIL_PREVIEW_FAILURE_CODES, InboundMailPreviewKind } from '@iam/contracts';
import { canOfferMailDelete } from './inbound-mail-delete-policy';

export type { InboundMailPreviewKind };

/** Cada cuánto se consulta el estado mientras la vista previa sigue pendiente. El worker pasa cada minuto. */
export const MAIL_PREVIEW_POLL_INTERVAL_MS = 5_000;

/**
 * Tope de consultas por ronda: 36 consultas a 5 s son tres minutos (tres pasadas del worker). Pasado el
 * tope se avisa que tarda más de lo esperado y la persona decide si consulta otra ronda.
 */
export const MAIL_PREVIEW_POLL_MAX_ATTEMPTS = 36;

export type MailPreviewFailureCode = (typeof INBOUND_MAIL_PREVIEW_FAILURE_CODES)[number];

/** Un resultado sin código (no debería ocurrir en un fallo) se trata como error interno, no como éxito. */
export function mailPreviewFailureCode(
  resultCode: MailPreviewFailureCode | null,
): MailPreviewFailureCode {
  return resultCode ?? 'UNEXPECTED';
}

/**
 * Comodidad de la interfaz: ver el correo sigue la misma regla que borrarlo (permiso `inbound.delete_mail`
 * y MANAGE sobre la vista). El servidor decide y audita; aquí solo no se ofrece lo que ya se sabe que no procede.
 */
export function canOfferMailPreview(
  hasDeleteMailPermission: boolean,
  level: string | undefined,
): boolean {
  return canOfferMailDelete(hasDeleteMailPermission, level);
}

/** El cuerpo completo, además, solo se ofrece a quien tiene `inbound.reveal_reset` (como revelar restablecimientos). */
export function canOfferMailBodyPreview(
  canPreview: boolean,
  hasRevealResetPermission: boolean,
): boolean {
  return canPreview && hasRevealResetPermission;
}
