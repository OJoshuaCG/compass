/**
 * Aviso de cambio de rango tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO ids y números: a quién se le cambió el rango, quién lo hizo, los
 * rangos y el momento. Nunca el motivo (va a la auditoría), la lista de roles retirados, nombres ni
 * correos: el manejador los resuelve al enviar, desde el directorio, para que no queden copiados en la
 * bandeja de salida.
 */
import { isRank } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';

/** `type` del evento en `outbox_events`; lo escribe el cambio de rango y lo consume su manejador. */
export const RANK_CHANGE_NOTICE_EVENT_TYPE = 'user.rank_changed';

/** Agregado del evento en `outbox_events`. */
export const RANK_CHANGE_NOTICE_AGGREGATE = 'user';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const RANK_CHANGE_NOTICE_HANDLER_KEY = 'directory.rank-change-notice';

/**
 * Clave del acuse de UNA destinataria (la persona afectada). Largo: prefijo (28) + ':' + UUID (36) = 65,
 * dentro del límite de 100 de `handler_key`.
 */
export function rankChangeNoticeHandlerKey(recipientId: string): string {
  return `${RANK_CHANGE_NOTICE_HANDLER_KEY}:${recipientId}`;
}

export interface RankChangeNoticePayload {
  readonly targetId: string;
  readonly changedBy: string;
  readonly fromRank: Rank;
  readonly toRank: Rank;
  readonly changedAt: Date;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, queda en cuarentena. */
export class RankChangeNoticePayloadError extends Error {
  readonly code = 'DIRECTORY.RANK_NOTICE_PAYLOAD_INVALID';
  /** Reintentar no lo arregla: el trabajador del outbox lo manda a cuarentena sin reintentos. */
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Rank change notice payload is invalid');
    this.name = 'RankChangeNoticePayloadError';
  }
}

/** El envío falló: se lanza para que el trabajador reintente con espera. */
export class RankChangeNoticeDeliveryError extends Error {
  readonly code = 'DIRECTORY.RANK_NOTICE_SEND_FAILED';

  constructor() {
    super('Rank change notice could not be delivered');
    this.name = 'RankChangeNoticeDeliveryError';
  }
}

export function serializeRankChangeNotice(notice: {
  readonly targetId: string;
  readonly changedBy: string;
  readonly fromRank: Rank;
  readonly toRank: Rank;
  readonly changedAt: Date;
}): Record<string, string | number> {
  return {
    targetId: notice.targetId,
    changedBy: notice.changedBy,
    fromRank: notice.fromRank,
    toRank: notice.toRank,
    changedAt: notice.changedAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isValidRank = (value: unknown): value is Rank =>
  typeof value === 'number' && Number.isInteger(value) && isRank(value);

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseRankChangeNoticePayload(payload: unknown): RankChangeNoticePayload {
  if (!isPlainObject(payload)) throw new RankChangeNoticePayloadError();
  const { targetId, changedBy, fromRank, toRank, changedAt } = payload;
  if (!isNonEmptyString(targetId) || !isNonEmptyString(changedBy)) {
    throw new RankChangeNoticePayloadError();
  }
  if (!isValidRank(fromRank) || !isValidRank(toRank)) throw new RankChangeNoticePayloadError();
  if (typeof changedAt !== 'string') throw new RankChangeNoticePayloadError();
  const changedAtDate = new Date(changedAt);
  if (Number.isNaN(changedAtDate.getTime())) throw new RankChangeNoticePayloadError();
  return { targetId, changedBy, fromRank, toRank, changedAt: changedAtDate };
}
