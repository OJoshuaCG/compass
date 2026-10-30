/**
 * Vigencia del elemento extraído (ADR 0045 sección 3 y 6, IC-1). Funciones puras: el reloj es parámetro.
 *
 * El elemento vence `INBOUND_ITEM_TTL_MS` después de su base. La base es la fecha del mensaje SOLO si
 * viene firmada (DKIM, garantizado por la compuerta) y está dentro de la tolerancia respecto a la
 * recepción; la fecha de una cabecera sin firmar la controla el atacante y nunca se usa. Una fecha firmada
 * fuera de la tolerancia es una repetición de un correo legítimo (T2) o un reloj roto: se rechaza.
 */
import { INBOUND_ITEM_TTL_MS, MESSAGE_DATE_TOLERANCE_MS } from './inbound-limits.js';

export type ItemExpiryResult =
  | { readonly ok: true; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: 'MESSAGE_DATE_OUT_OF_TOLERANCE' };

const OUT_OF_TOLERANCE: ItemExpiryResult = {
  ok: false,
  reason: 'MESSAGE_DATE_OUT_OF_TOLERANCE',
};

/**
 * `signedMessageDate` debe ser `null` cuando la fecha NO está firmada (por ejemplo en SMS); en ese caso
 * la vigencia cuenta desde la recepción.
 */
export function computeItemExpiry(
  receivedAt: Date,
  signedMessageDate: Date | null,
): ItemExpiryResult {
  const receivedAtMs = receivedAt.getTime();
  if (Number.isNaN(receivedAtMs)) return OUT_OF_TOLERANCE;
  if (signedMessageDate === null) {
    return { ok: true, expiresAt: new Date(receivedAtMs + INBOUND_ITEM_TTL_MS) };
  }

  const messageDateMs = signedMessageDate.getTime();
  if (Number.isNaN(messageDateMs)) return OUT_OF_TOLERANCE;
  const skewMs = Math.abs(receivedAtMs - messageDateMs);
  if (skewMs > MESSAGE_DATE_TOLERANCE_MS) return OUT_OF_TOLERANCE;

  // Con una fecha adelantada dentro de la tolerancia se cuenta desde la recepción: nunca se alarga la vigencia.
  const baseMs = Math.min(messageDateMs, receivedAtMs);
  return { ok: true, expiresAt: new Date(baseMs + INBOUND_ITEM_TTL_MS) };
}

/** `true` en el instante exacto del vencimiento y después; una fecha inválida cuenta como vencida. */
export function isItemExpired(expiresAt: Date, now: Date): boolean {
  return !(now.getTime() < expiresAt.getTime());
}
