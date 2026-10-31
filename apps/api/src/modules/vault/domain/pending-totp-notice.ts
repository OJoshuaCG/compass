/**
 * Aviso de "segundo factor registrado y sin confirmar por más de 24 horas" (S10, DF-6 de `two-factor.md`)
 * tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO ids y una fecha: la credencial, quién registró y cuándo se registró.
 * Nunca la clave ni el URI del segundo factor, ni el nombre de la credencial o de la cuenta. El nombre y el
 * correo de quien registró se resuelven al enviar, desde el directorio, para que no queden copiados en la
 * bandeja de salida.
 */

/** `type` del evento en `outbox_events`; lo escribe el barrido y lo consume su manejador. */
export const PENDING_TOTP_NOTICE_EVENT_TYPE = 'credential.totp_pending_unconfirmed';

/** Agregado del evento en `outbox_events`. */
export const PENDING_TOTP_NOTICE_AGGREGATE = 'credential';

/**
 * Prefijo estable del manejador en los acuses de entrega (`outbox_deliveries.handler_key`). No debe cambiar:
 * si cambiara, los avisos ya enviados se volverían a enviar.
 */
export const PENDING_TOTP_NOTICE_HANDLER_KEY = 'vault.pending-totp-notice';

/**
 * Clave del acuse de UNA destinataria. Hoy solo avisa a quien registró (regla del negocio sin definir para
 * otras personas, ver `odd/tasks/phase-1b-worker.md`), pero el acuse es por (evento, destinataria) igual que
 * el del aviso de revelaciones, para poder sumar destinatarias sin reenviar a las anteriores.
 * Largo: prefijo (26) + ':' + UUID (36) = 63, dentro del límite de 100 de `handler_key`.
 */
export function pendingTotpNoticeHandlerKey(recipientId: string): string {
  return `${PENDING_TOTP_NOTICE_HANDLER_KEY}:${recipientId}`;
}

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** Horas que un segundo factor puede estar pendiente antes de avisar (S10: "un `pending` sin verificar en 24 horas"). */
export const PENDING_TOTP_NOTICE_AFTER_HOURS = 24;

/** Antigüedad mínima, en milisegundos, de un registro pendiente para que genere el aviso. */
export const PENDING_TOTP_NOTICE_AFTER_MS = PENDING_TOTP_NOTICE_AFTER_HOURS * MILLISECONDS_PER_HOUR;

/** Un registro pendiente vencido que el barrido acaba de reclamar (ya con `pending_notice_at` marcado). */
export interface DuePendingTotp {
  readonly credentialId: string;
  readonly registeredBy: string;
  readonly registeredAt: Date;
}

export interface PendingTotpNoticePayload {
  readonly credentialId: string;
  readonly registeredBy: string;
  readonly registeredAt: Date;
}

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, se deja en cuarentena para revisión. */
export class PendingTotpNoticePayloadError extends Error {
  readonly code = 'VAULT.PENDING_TOTP_NOTICE_PAYLOAD_INVALID';
  /** Reintentar no lo arregla: el trabajador del outbox lo manda a cuarentena sin reintentos. */
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Pending totp notice payload is invalid');
    this.name = 'PendingTotpNoticePayloadError';
  }
}

/** El envío del aviso falló; el trabajador reintenta con espera y, agotados los intentos, lo deja en cuarentena. */
export class PendingTotpNoticeDeliveryError extends Error {
  readonly code = 'VAULT.PENDING_TOTP_NOTICE_SEND_FAILED';

  constructor() {
    // Sin el mensaje del proveedor: puede citar el destinatario.
    super('Pending totp notice could not be delivered');
    this.name = 'PendingTotpNoticeDeliveryError';
  }
}

export function serializePendingTotpNotice(due: DuePendingTotp): Record<string, string> {
  return {
    credentialId: due.credentialId,
    registeredBy: due.registeredBy,
    registeredAt: due.registeredAt.toISOString(),
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parsePendingTotpNoticePayload(payload: unknown): PendingTotpNoticePayload {
  if (!isPlainObject(payload)) throw new PendingTotpNoticePayloadError();
  const { credentialId, registeredBy, registeredAt } = payload;
  if (!isNonEmptyString(credentialId)) throw new PendingTotpNoticePayloadError();
  if (!isNonEmptyString(registeredBy)) throw new PendingTotpNoticePayloadError();
  if (typeof registeredAt !== 'string') throw new PendingTotpNoticePayloadError();
  const registeredAtDate = new Date(registeredAt);
  if (Number.isNaN(registeredAtDate.getTime())) throw new PendingTotpNoticePayloadError();
  return { credentialId, registeredBy, registeredAt: registeredAtDate };
}
