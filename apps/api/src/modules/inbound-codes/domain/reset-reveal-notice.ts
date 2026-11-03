/**
 * Aviso a la Raíz por una revelación de restablecimientos (ADR 0045) tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO ids, un conteo y la hora: quién (id opaco), qué vista (id opaco),
 * cuántos restablecimientos y cuándo. Nunca el valor, el motivo, la dirección de la fuente ni nombres. El
 * nombre de la persona y el correo de la Raíz se resuelven al enviar, desde el directorio.
 */

/** `type` del evento en `outbox_events`; lo escribe la revelación y lo consume su manejador. */
export const RESET_REVEAL_NOTICE_EVENT_TYPE = 'inbound.reset_revealed';

/** Agregado del evento en `outbox_events`. */
export const RESET_REVEAL_NOTICE_AGGREGATE = 'mail_view';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const RESET_REVEAL_NOTICE_HANDLER_KEY = 'inbound.reset-reveal-notice';

/**
 * Clave del acuse de UNA destinataria: el reintento reenvía solo a las pendientes.
 * Largo: prefijo (27) + ':' + UUID (36) = 64, dentro del límite de 100 de `handler_key`.
 */
export function resetRevealNoticeHandlerKey(recipientId: string): string {
  return `${RESET_REVEAL_NOTICE_HANDLER_KEY}:${recipientId}`;
}

export interface ResetRevealNoticePayload {
  readonly actorId: string;
  readonly viewId: string;
  readonly revealedCount: number;
  readonly revealedAt: Date;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, va a cuarentena. */
export class ResetRevealNoticePayloadError extends Error {
  readonly code = 'INBOUND.RESET_NOTICE_PAYLOAD_INVALID';
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Reset reveal notice payload is invalid');
    this.name = 'ResetRevealNoticePayloadError';
  }
}

/** No hay a quién avisar (la organización no tiene una Raíz activa) o el envío falló. */
export class ResetRevealNoticeDeliveryError extends Error {
  readonly code: 'INBOUND.RESET_NOTICE_NO_ROOT' | 'INBOUND.RESET_NOTICE_SEND_FAILED';

  constructor(code: 'INBOUND.RESET_NOTICE_NO_ROOT' | 'INBOUND.RESET_NOTICE_SEND_FAILED') {
    super('Reset reveal notice could not be delivered');
    this.name = 'ResetRevealNoticeDeliveryError';
    this.code = code;
  }
}

export function serializeResetRevealNotice(
  notice: ResetRevealNoticePayload,
): Record<string, string | number> {
  return {
    actorId: notice.actorId,
    viewId: notice.viewId,
    revealedCount: notice.revealedCount,
    revealedAt: notice.revealedAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseResetRevealNoticePayload(payload: unknown): ResetRevealNoticePayload {
  if (!isPlainObject(payload)) throw new ResetRevealNoticePayloadError();
  const { actorId, viewId, revealedCount, revealedAt } = payload;
  if (!isNonEmptyString(actorId) || !isNonEmptyString(viewId)) {
    throw new ResetRevealNoticePayloadError();
  }
  if (typeof revealedCount !== 'number' || !Number.isInteger(revealedCount) || revealedCount < 1) {
    throw new ResetRevealNoticePayloadError();
  }
  if (typeof revealedAt !== 'string') throw new ResetRevealNoticePayloadError();
  const revealedAtDate = new Date(revealedAt);
  if (Number.isNaN(revealedAtDate.getTime())) throw new ResetRevealNoticePayloadError();
  return { actorId, viewId, revealedCount, revealedAt: revealedAtDate };
}
