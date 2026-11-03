import type { SecretContext } from '../../crypto/index.js';

/** Nombre del campo en el contexto de cifrado (AAD) de la contraseña del buzón (ADR 0045, punto 3). */
export const MAIL_SOURCE_PASSWORD_FIELD = 'mail_source_password';

/**
 * Contexto de cifrado de la contraseña IMAP de una fuente. Lo comparten el guardado de la conexión
 * (IC-5b), el sondeo (IC-3c) y el recifrado por rotación de DEK (ADR 0040): si divergieran, la
 * contraseña recifrada dejaría de poder abrirse. `secretVersion` sube cada vez que se reintroduce.
 */
export function mailSourcePasswordContext(
  organizationId: SecretContext['organizationId'],
  sourceId: string,
  secretVersion: number,
): SecretContext {
  return {
    organizationId,
    resourceId: sourceId,
    field: MAIL_SOURCE_PASSWORD_FIELD,
    version: secretVersion,
  };
}
