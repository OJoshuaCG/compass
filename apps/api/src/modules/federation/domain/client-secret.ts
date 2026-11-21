/**
 * El secreto del cliente se guarda en una sola columna (`secret_ciphertext`). Formato:
 * `versión de la DEK (4 bytes, big endian) | nonce (12) | texto cifrado con etiqueta`.
 */
import type { EncryptedSecret, SecretContext } from '../../crypto/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';

const DEK_VERSION_BYTES = 4;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** El `resourceId` ata el texto cifrado a su cliente: copiarlo a otra fila no lo abre. */
export const clientSecretContext = (
  organizationId: OrganizationId,
  clientRowId: string,
): SecretContext => ({
  organizationId,
  resourceId: clientRowId,
  field: 'oidc_client_secret',
  version: 1,
});

export function packClientSecret(secret: EncryptedSecret): Uint8Array {
  const packed = new Uint8Array(DEK_VERSION_BYTES + secret.nonce.length + secret.ciphertext.length);
  new DataView(packed.buffer).setUint32(0, secret.dekVersion);
  packed.set(secret.nonce, DEK_VERSION_BYTES);
  packed.set(secret.ciphertext, DEK_VERSION_BYTES + secret.nonce.length);
  return packed;
}

/** Devuelve `null` si el valor guardado no tiene el formato esperado. */
export function unpackClientSecret(packed: Uint8Array): EncryptedSecret | null {
  if (packed.length < DEK_VERSION_BYTES + NONCE_BYTES + GCM_TAG_BYTES) return null;
  const dekVersion = new DataView(packed.buffer, packed.byteOffset, packed.byteLength).getUint32(0);
  const nonce = packed.slice(DEK_VERSION_BYTES, DEK_VERSION_BYTES + NONCE_BYTES);
  const ciphertext = packed.slice(DEK_VERSION_BYTES + NONCE_BYTES);
  return { dekVersion, nonce, ciphertext };
}
