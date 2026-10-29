import type { CreateShareRequest, ShareLevel } from '@iam/contracts';

/** Nivel con el que arranca el formulario: el menor privilegio, para no conceder de más por descuido. */
export const DEFAULT_SHARE_LEVEL: ShareLevel = 'USE';

export type ShareFormValues = {
  /** Persona elegida en la búsqueda; `undefined` mientras no se elige. */
  granteeId: string | undefined;
  level: ShareLevel;
  /** Valor de un campo `datetime-local` ("2030-01-31T18:30", sin zona); vacío si no caduca. */
  expiresAtLocal: string;
};

export type ShareFormError = 'granteeRequired' | 'expiryInvalid' | 'expiryPast';

export type ShareFormResult =
  { ok: true; request: CreateShareRequest } | { ok: false; error: ShareFormError };

/**
 * Arma el cuerpo de `POST /accounts/:id/shares` desde el formulario. `new Date("…T18:30")` lee la
 * hora en la zona del navegador, que es donde la persona eligió la fecha; el servidor recibe el
 * instante en UTC (ISO). El tope de un año lo aplica solo el servidor: aquí basta con que sea futura.
 */
export function buildShareRequest(values: ShareFormValues, now: Date): ShareFormResult {
  if (values.granteeId === undefined) {
    return { ok: false, error: 'granteeRequired' };
  }

  const baseRequest: CreateShareRequest = {
    granteeType: 'user',
    granteeId: values.granteeId,
    level: values.level,
  };

  if (values.expiresAtLocal === '') {
    return { ok: true, request: baseRequest };
  }

  const expiresAt = new Date(values.expiresAtLocal);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: 'expiryInvalid' };
  }
  if (expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'expiryPast' };
  }
  return { ok: true, request: { ...baseRequest, expiresAt: expiresAt.toISOString() } };
}
