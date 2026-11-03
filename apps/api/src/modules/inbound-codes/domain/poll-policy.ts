/**
 * Política del sondeo IMAP de una fuente (ADR 0045, "Diseño de IC-3 por IMAP", pasos 2, 7, 8 y 14).
 *
 * Funciones y constantes puras: el reloj entra como parámetro. Las cifras son las propuestas del ADR y
 * las confirma una persona con tráfico real antes de producción.
 */
import { MESSAGE_DATE_TOLERANCE_MS, MILLISECONDS_PER_MINUTE } from './inbound-limits.js';

const MILLISECONDS_PER_SECOND = 1000;

/** Vigencia del arrendamiento de una pasada; si el proceso muere, vence solo. */
export const POLL_LEASE_MS = 90 * MILLISECONDS_PER_SECOND;

/** Tiempo máximo que una pasada dedica a una fuente. */
export const POLL_SOURCE_BUDGET_MS = 60 * MILLISECONDS_PER_SECOND;

/**
 * Antigüedad máxima de un mensaje que se procesa: la tolerancia de fecha, el intervalo del cron (1 minuto)
 * y un margen. El código dura 10 minutos, así que uno más viejo ya no sirve.
 */
export const POLL_MESSAGE_WINDOW_MS = 15 * MILLISECONDS_PER_MINUTE;

if (POLL_MESSAGE_WINDOW_MS <= MESSAGE_DATE_TOLERANCE_MS) {
  throw new Error('POLL_MESSAGE_WINDOW_MS must exceed the message date tolerance');
}

/** Mensajes que se procesan por fuente y por pasada (los más nuevos primero). */
export const POLL_MAX_MESSAGES_PER_PASS = 50;

/** Tamaño máximo de un mensaje crudo; uno mayor se registra como cuarentena sin descargarse. */
export const POLL_MAX_MESSAGE_BYTES = 256 * 1024;

/** Retroceso por fallos de conexión: base, y tope de 1 hora. */
const BACKOFF_BASE_MS = MILLISECONDS_PER_MINUTE;
export const POLL_BACKOFF_CAP_MS = 60 * MILLISECONDS_PER_MINUTE;

/** Exponente a partir del cual el tope ya se alcanzó; evita desbordes con conteos enormes. */
const MAX_BACKOFF_EXPONENT = 20;

/**
 * Espera antes del siguiente intento tras `consecutiveFailures` fallos seguidos (el primero espera 1
 * minuto, luego 2, 4... hasta el tope). Un conteo inválido o menor que 1 se trata como el primer fallo.
 */
export function computeBackoffMs(consecutiveFailures: number): number {
  const isUsableCount = Number.isInteger(consecutiveFailures) && consecutiveFailures >= 1;
  const failures = isUsableCount ? consecutiveFailures : 1;
  const exponent = Math.min(failures - 1, MAX_BACKOFF_EXPONENT);
  return Math.min(BACKOFF_BASE_MS * 2 ** exponent, POLL_BACKOFF_CAP_MS);
}

/** Momento antes del cual un mensaje ya no se procesa. */
export function computeWindowStart(now: Date): Date {
  return new Date(now.getTime() - POLL_MESSAGE_WINDOW_MS);
}
