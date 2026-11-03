import type { SecretContext } from '../../crypto/index.js';

/** Campos secretos que puede guardar una integración (coinciden con el CHECK de `integration_secrets.field`). */
export const INTEGRATION_SECRET_FIELDS = ['bot_token', 'api_key'] as const;
export type IntegrationSecretField = (typeof INTEGRATION_SECRET_FIELDS)[number];

/** Prefijo del campo en el contexto de cifrado (AAD): separa estos secretos de los de otros módulos. */
const CONTEXT_FIELD_PREFIX = 'integration.';

/**
 * Contexto de cifrado (AAD) del secreto de una integración. Lo comparten el guardado del secreto y el
 * recifrado por rotación de DEK (ADR 0040): si divergieran, el secreto recifrado dejaría de poder
 * abrirse. `secretVersion` sube cada vez que una persona lo reintroduce.
 */
export function integrationSecretContext(
  organizationId: SecretContext['organizationId'],
  integrationId: string,
  field: IntegrationSecretField,
  secretVersion: number,
): SecretContext {
  return {
    organizationId,
    resourceId: integrationId,
    field: `${CONTEXT_FIELD_PREFIX}${field}`,
    version: secretVersion,
  };
}

/** Separador del cursor de recifrado; ni un UUID ni un nombre de campo lo contienen. */
const CURSOR_SEPARATOR = ':';

/** El recifrado avanza por la llave primaria compuesta (integración, campo); el cursor la serializa. */
export function formatIntegrationSecretCursor(
  integrationId: string,
  field: IntegrationSecretField,
): string {
  return `${integrationId}${CURSOR_SEPARATOR}${field}`;
}

export function parseIntegrationSecretCursor(
  cursor: string,
): { integrationId: string; field: string } | null {
  const separatorIndex = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) return null;
  return {
    integrationId: cursor.slice(0, separatorIndex),
    field: cursor.slice(separatorIndex + 1),
  };
}
