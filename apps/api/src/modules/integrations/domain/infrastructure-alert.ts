/**
 * Alerta de infraestructura para la Raíz (ADR 0047) tal como viaja por el outbox (ADR 0035).
 *
 * El contenido (`payload`) lleva SOLO un código de una lista cerrada y la hora. El texto que sale por
 * Telegram se arma aquí con plantillas fijas: ningún dato del evento (mensajes de error, rutas, hosts,
 * nombres de personas) llega al chat, porque un chat de Telegram es un canal externo a la plataforma.
 */

/** `type` del evento en `outbox_events`; lo escribe quien detecta el problema y lo consume el notificador. */
export const INFRASTRUCTURE_ALERT_EVENT_TYPE = 'integration.infra_alert';

/**
 * Clave del acuse de entrega por destino (tabla de acuses del outbox): el reintento de un evento solo reenvía
 * a los destinos que faltaron, así una falla del correo no repite el aviso por Telegram ni al revés.
 */
export const INFRASTRUCTURE_ALERT_HANDLER_KEY = 'integration.infra-alert';

export function infrastructureAlertTelegramKey(): string {
  return `${INFRASTRUCTURE_ALERT_HANDLER_KEY}:telegram`;
}

export function infrastructureAlertEmailKey(recipientId: string): string {
  return `${INFRASTRUCTURE_ALERT_HANDLER_KEY}:email:${recipientId}`;
}

/** Agregado del evento en `outbox_events`. */
export const INFRASTRUCTURE_ALERT_AGGREGATE = 'integration';

/** Lista cerrada de alertas. Agregar un código nuevo exige agregar su texto en ambos idiomas. */
export const INFRASTRUCTURE_ALERT_CODES = [
  'service_unhealthy',
  'job_failed',
  'events_quarantined',
] as const;

export type InfrastructureAlertCode = (typeof INFRASTRUCTURE_ALERT_CODES)[number];

export interface InfrastructureAlertPayload {
  readonly code: InfrastructureAlertCode;
  readonly occurredAt: Date;
}

/** Texto por código, en es-MX y en-US: la Raíz puede leer cualquiera de los dos idiomas del producto. */
const ALERT_TEXT: Readonly<Record<InfrastructureAlertCode, { esMx: string; enUs: string }>> = {
  service_unhealthy: {
    esMx: 'Un servicio de la plataforma no está respondiendo con normalidad.',
    enUs: 'A platform service is not responding normally.',
  },
  job_failed: {
    esMx: 'Una tarea programada de la plataforma falló y requiere atención.',
    enUs: 'A scheduled platform job failed and needs attention.',
  },
  events_quarantined: {
    esMx: 'Hay eventos internos en cuarentena que requieren revisión.',
    enUs: 'Some internal events are quarantined and need review.',
  },
};

/** El contenido del evento no tiene la forma esperada: reintentar no lo arregla, va a cuarentena. */
export class InfrastructureAlertPayloadError extends Error {
  readonly code = 'INTEGRATIONS.ALERT_PAYLOAD_INVALID';
  readonly retryable = false;

  constructor() {
    // Sin el contenido en el mensaje: el payload nunca se registra.
    super('Infrastructure alert payload is invalid');
    this.name = 'InfrastructureAlertPayloadError';
  }
}

export type InfrastructureAlertDeliveryErrorCode =
  | 'INTEGRATIONS.ALERT_SECRET_UNAVAILABLE'
  | 'INTEGRATIONS.ALERT_CONFIG_INVALID'
  | 'INTEGRATIONS.ALERT_SEND_FAILED';

/** El aviso no pudo entregarse. `retryable = false` indica una configuración que una persona debe corregir. */
export class InfrastructureAlertDeliveryError extends Error {
  readonly code: InfrastructureAlertDeliveryErrorCode;
  readonly retryable: boolean;

  constructor(code: InfrastructureAlertDeliveryErrorCode, retryable: boolean) {
    // Ni el token, ni el chat, ni la respuesta de Telegram entran en el mensaje.
    super('Infrastructure alert could not be delivered');
    this.name = 'InfrastructureAlertDeliveryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function serializeInfrastructureAlert(
  alert: InfrastructureAlertPayload,
): Record<string, string> {
  return { code: alert.code, occurredAt: alert.occurredAt.toISOString() };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAlertCode = (value: unknown): value is InfrastructureAlertCode =>
  typeof value === 'string' && (INFRASTRUCTURE_ALERT_CODES as readonly string[]).includes(value);

/** Valida el contenido que llega del outbox (es `unknown`: viene de una columna jsonb). */
export function parseInfrastructureAlertPayload(payload: unknown): InfrastructureAlertPayload {
  if (!isPlainObject(payload)) throw new InfrastructureAlertPayloadError();
  const { code, occurredAt } = payload;
  if (!isAlertCode(code) || typeof occurredAt !== 'string') {
    throw new InfrastructureAlertPayloadError();
  }
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) throw new InfrastructureAlertPayloadError();
  return { code, occurredAt: occurredAtDate };
}

/** Texto plano de la alerta: etiqueta fija, descripción en ambos idiomas y la hora en UTC. */
export function buildInfrastructureAlertText(alert: InfrastructureAlertPayload): string {
  const text = ALERT_TEXT[alert.code];
  return [
    '[Compass] Infraestructura / Infrastructure',
    text.esMx,
    text.enUs,
    `UTC: ${alert.occurredAt.toISOString()}`,
  ].join('\n');
}
