/**
 * Aviso a la Raíz por superar el tope de revelaciones (ADR 0031) tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO ids y números: quién (id opaco), el tope, cuántas revelaciones se
 * contaron, el largo de la ventana y cuándo se levantó el aviso. Nunca el nombre de la credencial ni de la
 * cuenta, el motivo escrito ni ningún secreto. El nombre de la persona y el correo de la Raíz se resuelven al
 * enviar, desde el directorio, para que no queden copiados en la bandeja de salida.
 */

/** `type` del evento en `outbox_events`; lo escribe el caso de uso de revelado y lo consume su manejador. */
export const REVEAL_LIMIT_NOTICE_EVENT_TYPE = 'credential.reveal_limit_exceeded';

/** Agregado del evento en `outbox_events`. */
export const REVEAL_LIMIT_NOTICE_AGGREGATE = 'credential';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const REVEAL_LIMIT_NOTICE_HANDLER_KEY = 'vault.reveal-limit-notice';

/**
 * Clave del acuse de UNA destinataria. El aviso va a todas las Raíces; si una sola falla, el reintento debe
 * reenviar únicamente a la pendiente, así que el acuse es por (evento, destinataria) y no solo por evento.
 * Largo: prefijo (25) + ':' + UUID (36) = 62, dentro del límite de 100 de `handler_key`.
 */
export function revealLimitNoticeHandlerKey(recipientId: string): string {
  return `${REVEAL_LIMIT_NOTICE_HANDLER_KEY}:${recipientId}`;
}

const SECONDS_PER_MINUTE = 60;

export interface RevealLimitNoticePayload {
  readonly actorId: string;
  readonly limitPerHour: number;
  /** `null` en eventos escritos antes de que el aviso llevara el conteo. */
  readonly revealedInWindow: number | null;
  /** `null` en eventos escritos antes de que el aviso llevara la ventana. */
  readonly windowMinutes: number | null;
  /** Momento en que se superó el tope; `null` en eventos antiguos (el manejador usa entonces la hora del envío). */
  readonly raisedAt: Date | null;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, se deja en cuarentena para revisión. */
export class RevealLimitNoticePayloadError extends Error {
  readonly code = 'VAULT.REVEAL_NOTICE_PAYLOAD_INVALID';

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Reveal limit notice payload is invalid');
    this.name = 'RevealLimitNoticePayloadError';
  }
}

/** No hay a quién avisar (la organización no tiene una Raíz activa) o el envío falló. */
export class RevealLimitNoticeDeliveryError extends Error {
  readonly code: 'VAULT.REVEAL_NOTICE_NO_ROOT' | 'VAULT.REVEAL_NOTICE_SEND_FAILED';

  constructor(code: 'VAULT.REVEAL_NOTICE_NO_ROOT' | 'VAULT.REVEAL_NOTICE_SEND_FAILED') {
    super('Reveal limit notice could not be delivered');
    this.name = 'RevealLimitNoticeDeliveryError';
    this.code = code;
  }
}

export function serializeRevealLimitNotice(notice: {
  readonly actorId: string;
  readonly limitPerHour: number;
  readonly revealedInWindow: number;
  readonly windowSeconds: number;
  readonly raisedAt: Date;
}): Record<string, string | number> {
  return {
    actorId: notice.actorId,
    limitPerHour: notice.limitPerHour,
    revealedInWindow: notice.revealedInWindow,
    windowSeconds: notice.windowSeconds,
    raisedAt: notice.raisedAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseRevealLimitNoticePayload(payload: unknown): RevealLimitNoticePayload {
  if (!isPlainObject(payload)) throw new RevealLimitNoticePayloadError();
  const { actorId, limitPerHour, revealedInWindow, windowSeconds, raisedAt } = payload;
  if (typeof actorId !== 'string' || actorId.length === 0)
    throw new RevealLimitNoticePayloadError();
  if (!isPositiveInteger(limitPerHour)) throw new RevealLimitNoticePayloadError();
  if (revealedInWindow !== undefined && !isPositiveInteger(revealedInWindow)) {
    throw new RevealLimitNoticePayloadError();
  }
  if (windowSeconds !== undefined && !isPositiveInteger(windowSeconds)) {
    throw new RevealLimitNoticePayloadError();
  }
  let raisedAtDate: Date | null = null;
  if (raisedAt !== undefined) {
    if (typeof raisedAt !== 'string') throw new RevealLimitNoticePayloadError();
    raisedAtDate = new Date(raisedAt);
    if (Number.isNaN(raisedAtDate.getTime())) throw new RevealLimitNoticePayloadError();
  }
  return {
    actorId,
    limitPerHour,
    revealedInWindow: revealedInWindow ?? null,
    windowMinutes:
      windowSeconds === undefined ? null : Math.round(windowSeconds / SECONDS_PER_MINUTE),
    raisedAt: raisedAtDate,
  };
}
