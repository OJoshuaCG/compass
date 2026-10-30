/**
 * Topes y vigencias del dominio de códigos entrantes (ADR 0045, IC-1).
 *
 * Todo lo que llega de un tercero (asunto, cuerpo, direcciones) y todo lo que escribe una plantilla se
 * acota antes de procesarlo: ninguna función de este módulo recorre una entrada sin tope. Las cifras
 * marcadas "propuesta" en el ADR las confirma una persona antes de producción.
 */

export const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Largo máximo de una dirección (RFC 5321: 254 caracteres útiles). */
export const MAX_ADDRESS_LENGTH = 254;

/** Largo máximo de un nombre de anfitrión (RFC 1035). */
export const MAX_HOSTNAME_LENGTH = 253;

/** Largo máximo del asunto que se compara; uno más largo es hostil o irrelevante y va a cuarentena. */
export const MAX_SUBJECT_LENGTH = 512;

/**
 * Largo máximo del texto de cuerpo que se procesa. Un cuerpo mayor se rechaza entero y no se trunca:
 * truncar podría cortar un código más largo y dejar un prefijo con el largo esperado.
 */
export const MAX_PROCESSED_BODY_LENGTH = 64 * 1024;

/** Largo máximo de cualquier literal (ancla, cierre, asunto, prefijo de ruta) que defina una plantilla. */
export const MAX_TEMPLATE_LITERAL_LENGTH = 128;

/** Rango admitido para el largo fijo de un código. */
export const MIN_CODE_LENGTH = 4;
export const MAX_CODE_LENGTH = 12;

/** Largo máximo de un enlace candidato; uno mayor se ignora. */
export const MAX_LINK_LENGTH = 2048;

/** Cuántos anfitriones permitidos puede declarar una plantilla de enlace. */
export const MAX_ALLOWED_LINK_HOSTS = 8;

/** Largo máximo de la huella de deduplicación (el hash ya viene calculado, aquí solo se acota). */
export const MAX_FINGERPRINT_LENGTH = 128;

/** Vigencia del elemento extraído (plan, línea 790; ADR 0045 sección 3). */
export const INBOUND_ITEM_TTL_MINUTES = 10;
export const INBOUND_ITEM_TTL_MS = INBOUND_ITEM_TTL_MINUTES * MILLISECONDS_PER_MINUTE;

/**
 * Tolerancia entre la fecha firmada del mensaje y el momento de recepción, en ambos sentidos
 * (propuesta del ADR 0045: 5 minutos). Fuera de ella el mensaje es una repetición o viene de un reloj roto.
 */
export const MESSAGE_DATE_TOLERANCE_MINUTES = 5;
export const MESSAGE_DATE_TOLERANCE_MS = MESSAGE_DATE_TOLERANCE_MINUTES * MILLISECONDS_PER_MINUTE;
