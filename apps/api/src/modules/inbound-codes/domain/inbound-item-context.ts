import type { SecretContext } from '../../crypto/index.js';

/** Nombre del campo en el contexto de cifrado (AAD) del valor de un elemento (código o enlace). */
export const INBOUND_ITEM_VALUE_FIELD = 'inbound_item_value';

/** Los elementos son inmutables (sin UPDATE): su valor nunca se vuelve a sellar con otra versión de contexto. */
const INBOUND_ITEM_CONTEXT_VERSION = 1;

/**
 * Contexto de cifrado del valor de un elemento entrante. Lo comparten el sondeo (que lo cifra) y la
 * lectura/revelación (IC-5): si divergieran, el valor no podría abrirse. El id del elemento forma parte
 * del AAD, así que copiar el texto cifrado a otro elemento o a otra organización hace fallar el descifrado.
 */
export function inboundItemContext(
  organizationId: SecretContext['organizationId'],
  itemId: string,
): SecretContext {
  return {
    organizationId,
    resourceId: itemId,
    field: INBOUND_ITEM_VALUE_FIELD,
    version: INBOUND_ITEM_CONTEXT_VERSION,
  };
}
