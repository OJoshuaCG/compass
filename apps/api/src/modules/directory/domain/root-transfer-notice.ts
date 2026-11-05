/**
 * Aviso de la transferencia de la Raíz tal como viaja por el outbox (ADR 0035).
 *
 * El contenido lleva SOLO ids, el tipo de aviso y fechas: nunca nombres ni correos, que el manejador resuelve
 * al enviar desde el directorio para que no queden copiados en la bandeja de salida.
 */
export const ROOT_TRANSFER_NOTICE_EVENT_TYPE = 'root_transfer.notice';
export const ROOT_TRANSFER_NOTICE_AGGREGATE = 'root_transfer';
/** Prefijo estable de los acuses de entrega; si cambiara, los avisos ya enviados se reenviarían. */
export const ROOT_TRANSFER_NOTICE_HANDLER_KEY = 'directory.root-transfer-notice';

export const ROOT_TRANSFER_NOTICE_KINDS = [
  'requested',
  'accepted',
  'cancelled',
  'expired',
  'completed',
] as const;
export type RootTransferNoticeKind = (typeof ROOT_TRANSFER_NOTICE_KINDS)[number];

/** Clave del acuse de UNA destinataria: prefijo + ':' + id de transferencia + ':' + id de la persona. */
export function rootTransferNoticeHandlerKey(
  kind: RootTransferNoticeKind,
  transferId: string,
  recipientId: string,
): string {
  return `${ROOT_TRANSFER_NOTICE_HANDLER_KEY}:${kind}:${transferId}:${recipientId}`;
}

export interface RootTransferNoticePayload {
  readonly kind: RootTransferNoticeKind;
  readonly transferId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  /** Quién provocó el aviso; nulo si fue automático (caducidad, destinataria que dejó de ser elegible). */
  readonly actorId: string | null;
  readonly occurredAt: Date;
  /** Cuándo terminará la espera (solo en `accepted`). */
  readonly executesAt: Date | null;
}

export class RootTransferNoticePayloadError extends Error {
  readonly code = 'DIRECTORY.ROOT_TRANSFER_NOTICE_PAYLOAD_INVALID';
  /** Reintentar no lo arregla: el trabajador del outbox lo manda a cuarentena sin reintentos. */
  readonly retryable = false;

  constructor() {
    super('Root transfer notice payload is invalid');
    this.name = 'RootTransferNoticePayloadError';
  }
}

export class RootTransferNoticeDeliveryError extends Error {
  readonly code = 'DIRECTORY.ROOT_TRANSFER_NOTICE_SEND_FAILED';

  constructor() {
    super('Root transfer notice could not be delivered');
    this.name = 'RootTransferNoticeDeliveryError';
  }
}

export function serializeRootTransferNotice(
  notice: RootTransferNoticePayload,
): Record<string, string | null> {
  return {
    kind: notice.kind,
    transferId: notice.transferId,
    fromUserId: notice.fromUserId,
    toUserId: notice.toUserId,
    actorId: notice.actorId,
    occurredAt: notice.occurredAt.toISOString(),
    executesAt: notice.executesAt === null ? null : notice.executesAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isNoticeKind = (value: unknown): value is RootTransferNoticeKind =>
  typeof value === 'string' && (ROOT_TRANSFER_NOTICE_KINDS as readonly string[]).includes(value);

function parseDate(value: unknown): Date {
  if (typeof value !== 'string') throw new RootTransferNoticePayloadError();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RootTransferNoticePayloadError();
  return date;
}

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseRootTransferNoticePayload(payload: unknown): RootTransferNoticePayload {
  if (!isPlainObject(payload)) throw new RootTransferNoticePayloadError();
  const { kind, transferId, fromUserId, toUserId, actorId, occurredAt, executesAt } = payload;
  if (!isNoticeKind(kind)) throw new RootTransferNoticePayloadError();
  if (
    !isNonEmptyString(transferId) ||
    !isNonEmptyString(fromUserId) ||
    !isNonEmptyString(toUserId)
  ) {
    throw new RootTransferNoticePayloadError();
  }
  if (actorId !== null && !isNonEmptyString(actorId)) throw new RootTransferNoticePayloadError();
  return {
    kind,
    transferId,
    fromUserId,
    toUserId,
    actorId,
    occurredAt: parseDate(occurredAt),
    executesAt: executesAt === null ? null : parseDate(executesAt),
  };
}
