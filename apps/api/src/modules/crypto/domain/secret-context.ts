import type { OrganizationId } from '../../../shared/kernel/index.js';

/**
 * Identifica a qué pertenece un secreto. Se vincula al texto cifrado como AAD: copiar un
 * texto cifrado a otra credencial, campo o versión hace fallar el descifrado.
 */
export interface SecretContext {
  readonly organizationId: OrganizationId;
  readonly resourceId: string;
  readonly field: string;
  readonly version: number;
}

const encoder = new TextEncoder();

/** AAD = `org_id | resource_id | field | version` (plan: "Formato de cada secreto"). */
export function buildAad(context: SecretContext): Uint8Array {
  return encoder.encode(
    `${context.organizationId}|${context.resourceId}|${context.field}|${String(context.version)}`,
  );
}

/** Lo que se persiste: texto cifrado (con la etiqueta GCM al final), nonce y versión de la DEK. */
export interface EncryptedSecret {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}
