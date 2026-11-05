import type { InboundCodesResponse } from '@iam/contracts';

const MILLISECONDS_PER_SECOND = 1000;

/** Cada cuánto se revisa el vigor de los códigos en pantalla; menos de 1 s para no mostrar uno vencido. */
export const INBOUND_COUNTDOWN_TICK_MS = 500;

/** Un código copiado se borra del portapapeles a los 30 s, si todavía lo contiene (docs/business/vault.md §7.2). */
export const INBOUND_CLIPBOARD_CLEAR_MS = 30_000;
export const INBOUND_CLIPBOARD_CLEAR_SECONDS = INBOUND_CLIPBOARD_CLEAR_MS / MILLISECONDS_PER_SECOND;

/**
 * Código en pantalla. Al vencer, `code` pasa a `null`: el valor se descarta del estado y la fila
 * queda marcada como vencida, así un código vencido no sobrevive ni oculto en memoria.
 * Este tipo solo vive en el estado local del componente que lo muestra.
 */
export type ShownCode = {
  itemId: string;
  code: string | null;
  expiresAtMs: number;
};

export function shownCodesFrom(response: InboundCodesResponse): ShownCode[] {
  return response.data.map((item) => ({
    itemId: item.itemId,
    code: item.code,
    expiresAtMs: Date.parse(item.expiresAt),
  }));
}

export function isExpired(code: ShownCode, nowMs: number): boolean {
  return code.code === null || nowMs >= code.expiresAtMs;
}

/** Segundos que le quedan al código, redondeados hacia arriba para no mostrar 0 mientras sigue vigente. */
export function secondsLeftOf(code: ShownCode, nowMs: number): number {
  return Math.max(0, Math.ceil((code.expiresAtMs - nowMs) / MILLISECONDS_PER_SECOND));
}

/**
 * Descarta el valor de los códigos que ya vencieron. Devuelve la misma referencia mientras nada
 * vence, para que React no vuelva a pintar entre un segundo y otro.
 */
export function discardExpiredCodes(codes: ShownCode[], nowMs: number): ShownCode[] {
  const hasNewlyExpired = codes.some((code) => code.code !== null && nowMs >= code.expiresAtMs);
  if (!hasNewlyExpired) return codes;
  return codes.map((code) =>
    code.code !== null && nowMs >= code.expiresAtMs ? { ...code, code: null } : code,
  );
}

export function hasValidCode(codes: ShownCode[], nowMs: number): boolean {
  return codes.some((code) => !isExpired(code, nowMs));
}
