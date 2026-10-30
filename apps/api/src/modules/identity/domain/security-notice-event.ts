/**
 * Aviso de seguridad a la persona dueña de la cuenta, tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO ids, el tipo de aviso y el momento. Nunca el correo, el nombre,
 * la dirección de red, el dispositivo ni código o secreto alguno: el manejador resuelve destinatario e
 * idioma al enviar, desde el directorio, para que no queden copiados en la bandeja de salida.
 */
import type { SecurityNoticeKind } from '../../notification/index.js';

/** `type` del evento en `outbox_events`; lo escribe la acción que se avisa y lo consume su manejador. */
export const SECURITY_NOTICE_EVENT_TYPE = 'user.security_notice';

/** Agregado del evento en `outbox_events`. */
export const SECURITY_NOTICE_AGGREGATE = 'user';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const SECURITY_NOTICE_HANDLER_KEY = 'identity.security-notice';

/**
 * Tipos de aviso que salen por el outbox. Los demás (`SecurityNoticeKind`) se envían después del _commit_
 * con mejor esfuerzo; un tipo se pasa aquí solo cuando su flujo encola el evento en la misma transacción.
 */
export const OUTBOX_SECURITY_NOTICE_KINDS = [
  'totp_removed',
] as const satisfies readonly SecurityNoticeKind[];

export type OutboxSecurityNoticeKind = (typeof OUTBOX_SECURITY_NOTICE_KINDS)[number];

/**
 * Clave del acuse de UNA destinataria (la dueña de la cuenta). Largo: prefijo (24) + ':' + UUID (36) = 61,
 * dentro del límite de 100 de `handler_key`.
 */
export function securityNoticeHandlerKey(recipientId: string): string {
  return `${SECURITY_NOTICE_HANDLER_KEY}:${recipientId}`;
}

export interface SecurityNoticePayload {
  readonly userId: string;
  readonly kind: OutboxSecurityNoticeKind;
  readonly occurredAt: Date;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, queda en cuarentena. */
export class SecurityNoticePayloadError extends Error {
  readonly code = 'IDENTITY.SECURITY_NOTICE_PAYLOAD_INVALID';
  /** Reintentar no lo arregla: el trabajador del outbox lo manda a cuarentena sin reintentos. */
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Security notice payload is invalid');
    this.name = 'SecurityNoticePayloadError';
  }
}

/** El envío falló: se lanza para que el trabajador reintente con espera. */
export class SecurityNoticeDeliveryError extends Error {
  readonly code = 'IDENTITY.SECURITY_NOTICE_SEND_FAILED';

  constructor() {
    super('Security notice could not be delivered');
    this.name = 'SecurityNoticeDeliveryError';
  }
}

export function serializeSecurityNotice(notice: {
  readonly userId: string;
  readonly kind: OutboxSecurityNoticeKind;
  readonly occurredAt: Date;
}): Record<string, string> {
  return {
    userId: notice.userId,
    kind: notice.kind,
    occurredAt: notice.occurredAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isOutboxKind = (value: unknown): value is OutboxSecurityNoticeKind =>
  typeof value === 'string' && (OUTBOX_SECURITY_NOTICE_KINDS as readonly string[]).includes(value);

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseSecurityNoticePayload(payload: unknown): SecurityNoticePayload {
  if (!isPlainObject(payload)) throw new SecurityNoticePayloadError();
  const { userId, kind, occurredAt } = payload;
  if (!isNonEmptyString(userId) || !isOutboxKind(kind)) throw new SecurityNoticePayloadError();
  if (typeof occurredAt !== 'string') throw new SecurityNoticePayloadError();
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) throw new SecurityNoticePayloadError();
  return { userId, kind, occurredAt: occurredAtDate };
}
