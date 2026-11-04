/**
 * Aviso de una baja tal como viaja por el outbox (ADR 0035; governance §2.4).
 *
 * El contenido (`payload`) lleva SOLO ids, conteos y la hora: quién se fue, quién dio la baja, quién recibió
 * las cuentas y cuántas. Nunca nombres, correos, nombres de cuentas ni de credenciales: el manejador resuelve
 * los nombres al enviar, desde el directorio, para que no queden copiados en la bandeja de salida.
 */

/** `type` del evento en `outbox_events`; lo escribe la baja y lo consume su manejador. */
export const OFFBOARDING_NOTICE_EVENT_TYPE = 'user.offboarded';

/** Agregado del evento en `outbox_events`. */
export const OFFBOARDING_NOTICE_AGGREGATE = 'user';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const OFFBOARDING_NOTICE_HANDLER_KEY = 'directory.offboarding-notice';

/** Qué aviso recibe cada destinataria; el tipo forma parte de la clave para que una persona con dos papeles reciba ambos. */
export type OffboardingNoticeRole = 'receiver' | 'alert' | 'report';

/**
 * Clave del acuse de UNA destinataria en UN papel. Largo: prefijo (28) + ':' + papel (8 como máximo) + ':' +
 * UUID (36) = 74, dentro del límite de 100 de `handler_key`.
 */
export function offboardingNoticeHandlerKey(
  role: OffboardingNoticeRole,
  recipientId: string,
): string {
  return `${OFFBOARDING_NOTICE_HANDLER_KEY}:${role}:${recipientId}`;
}

export interface OffboardingNoticePayload {
  readonly leaverId: string;
  /** Quien dio la baja: recibe el informe. */
  readonly actorId: string;
  /** Quien recibió las cuentas; `null` si ninguna cuenta se reasignó. */
  readonly receiverId: string | null;
  /** Solo se avisa a quien recibe fuera de la rama de quien dio la baja. */
  readonly notifyReceiver: boolean;
  readonly assignedAccountCount: number;
  readonly unassignedAccountCount: number;
  readonly rotationTaskCount: number;
  readonly offboardedAt: Date;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, queda en cuarentena. */
export class OffboardingNoticePayloadError extends Error {
  readonly code = 'DIRECTORY.OFFBOARDING_NOTICE_PAYLOAD_INVALID';
  /** Reintentar no lo arregla: el trabajador del outbox lo manda a cuarentena sin reintentos. */
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Offboarding notice payload is invalid');
    this.name = 'OffboardingNoticePayloadError';
  }
}

/** El envío falló: se lanza para que el trabajador reintente con espera. */
export class OffboardingNoticeDeliveryError extends Error {
  readonly code = 'DIRECTORY.OFFBOARDING_NOTICE_SEND_FAILED';

  constructor() {
    super('Offboarding notice could not be delivered');
    this.name = 'OffboardingNoticeDeliveryError';
  }
}

export function serializeOffboardingNotice(
  notice: OffboardingNoticePayload,
): Record<string, string | number | boolean | null> {
  return {
    leaverId: notice.leaverId,
    actorId: notice.actorId,
    receiverId: notice.receiverId,
    notifyReceiver: notice.notifyReceiver,
    assignedAccountCount: notice.assignedAccountCount,
    unassignedAccountCount: notice.unassignedAccountCount,
    rotationTaskCount: notice.rotationTaskCount,
    offboardedAt: notice.offboardedAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseOffboardingNoticePayload(payload: unknown): OffboardingNoticePayload {
  if (!isPlainObject(payload)) throw new OffboardingNoticePayloadError();
  const {
    leaverId,
    actorId,
    receiverId,
    notifyReceiver,
    assignedAccountCount,
    unassignedAccountCount,
    rotationTaskCount,
    offboardedAt,
  } = payload;
  if (!isNonEmptyString(leaverId) || !isNonEmptyString(actorId)) {
    throw new OffboardingNoticePayloadError();
  }
  if (receiverId !== null && !isNonEmptyString(receiverId))
    throw new OffboardingNoticePayloadError();
  if (typeof notifyReceiver !== 'boolean') throw new OffboardingNoticePayloadError();
  if (
    !isCount(assignedAccountCount) ||
    !isCount(unassignedAccountCount) ||
    !isCount(rotationTaskCount)
  ) {
    throw new OffboardingNoticePayloadError();
  }
  if (typeof offboardedAt !== 'string') throw new OffboardingNoticePayloadError();
  const offboardedAtDate = new Date(offboardedAt);
  if (Number.isNaN(offboardedAtDate.getTime())) throw new OffboardingNoticePayloadError();
  return {
    leaverId,
    actorId,
    receiverId,
    notifyReceiver,
    assignedAccountCount,
    unassignedAccountCount,
    rotationTaskCount,
    offboardedAt: offboardedAtDate,
  };
}
