/**
 * Invariantes de seguridad
 * - Cifrado de sobre para secretos de la plataforma que no pertenecen a ninguna organización
 *   (claves de firma OIDC, ADR 0052): una DEK nueva por secreto, envuelta por el KMS.
 * - El contexto (`purpose`) se vincula al texto cifrado como AAD: copiar el sobre a otro propósito
 *   o a otra clave hace fallar el descifrado.
 * - La DEK en claro y el texto en claro se sobrescriben con ceros apenas se usan.
 * - Los errores de descifrado son genéricos y no distinguen qué falló.
 */
import { DomainError, asOrganizationId } from '../../../shared/kernel/index.js';
import { utf8 } from '../domain/blind-index.js';
import { decryptFailed, kmsUnavailable } from '../domain/crypto-errors.js';
import type { CryptoPrimitives } from './ports/crypto-primitives.js';
import type { KeyManagementPort } from './ports/key-management-port.js';

/**
 * El KMS exige un contexto de cifrado por organización; los secretos de plataforma usan este
 * identificador fijo, que no corresponde a ninguna organización real.
 */
export const PLATFORM_ENCRYPTION_CONTEXT = asOrganizationId('platform');

const ENVELOPE_FORMAT_VERSION = 1;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const LENGTH_FIELD_BYTES = 2;
const MAX_FIELD_LENGTH = 0xffff;

export interface PlatformEnvelopeDeps {
  readonly kms: KeyManagementPort;
  readonly primitives: CryptoPrimitives;
}

export class PlatformEnvelope {
  constructor(private readonly deps: PlatformEnvelopeDeps) {}

  /**
   * Formato: `versión(1) | largo keyRef(2) | keyRef | largo DEK envuelta(2) | DEK envuelta |
   * nonce(12) | texto cifrado con etiqueta`.
   */
  async seal(purpose: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const { kms, primitives } = this.deps;
    const generated = await this.callKms(() =>
      kms.generateDataKey({ organizationId: PLATFORM_ENCRYPTION_CONTEXT }),
    );
    try {
      const nonce = primitives.randomBytes(NONCE_LENGTH);
      const sealed = primitives.aesGcmEncrypt({
        key: generated.plaintext,
        nonce,
        aad: utf8(purpose),
        plaintext,
      });
      return packEnvelope(utf8(generated.keyRef), generated.wrapped, nonce, sealed);
    } finally {
      generated.plaintext.fill(0);
    }
  }

  async open(purpose: string, envelope: Uint8Array): Promise<Uint8Array> {
    const { kms, primitives } = this.deps;
    const parsed = unpackEnvelope(envelope);
    if (parsed === null) throw decryptFailed();

    const dataKey = await this.callKms(() =>
      kms.decryptDataKey({
        organizationId: PLATFORM_ENCRYPTION_CONTEXT,
        wrapped: parsed.wrapped,
        keyRef: new TextDecoder().decode(parsed.keyRef),
      }),
    );
    try {
      return primitives.aesGcmDecrypt({
        key: dataKey,
        nonce: parsed.nonce,
        aad: utf8(purpose),
        ciphertext: parsed.sealed,
      });
    } catch {
      throw decryptFailed();
    } finally {
      dataKey.fill(0);
    }
  }

  /** Falla cerrada: cualquier error del KMS se traduce a `CRYPTO.KMS_UNAVAILABLE`. */
  private async callKms<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw kmsUnavailable();
    }
  }
}

interface ParsedEnvelope {
  readonly keyRef: Uint8Array;
  readonly wrapped: Uint8Array;
  readonly nonce: Uint8Array;
  readonly sealed: Uint8Array;
}

function packEnvelope(
  keyRef: Uint8Array,
  wrapped: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
): Uint8Array {
  if (keyRef.length > MAX_FIELD_LENGTH || wrapped.length > MAX_FIELD_LENGTH) {
    throw new RangeError('Envelope field is too long');
  }
  const total =
    1 +
    LENGTH_FIELD_BYTES +
    keyRef.length +
    LENGTH_FIELD_BYTES +
    wrapped.length +
    nonce.length +
    sealed.length;
  const packed = new Uint8Array(total);
  const view = new DataView(packed.buffer);
  let offset = 0;
  packed[offset] = ENVELOPE_FORMAT_VERSION;
  offset += 1;
  view.setUint16(offset, keyRef.length);
  offset += LENGTH_FIELD_BYTES;
  packed.set(keyRef, offset);
  offset += keyRef.length;
  view.setUint16(offset, wrapped.length);
  offset += LENGTH_FIELD_BYTES;
  packed.set(wrapped, offset);
  offset += wrapped.length;
  packed.set(nonce, offset);
  offset += nonce.length;
  packed.set(sealed, offset);
  return packed;
}

/** Devuelve `null` ante cualquier forma inválida: nunca lanza ni lee fuera de límites. */
function unpackEnvelope(envelope: Uint8Array): ParsedEnvelope | null {
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  let offset = 0;
  if (envelope.length < 1 || envelope[offset] !== ENVELOPE_FORMAT_VERSION) return null;
  offset += 1;

  const readField = (): Uint8Array | null => {
    if (offset + LENGTH_FIELD_BYTES > envelope.length) return null;
    const length = view.getUint16(offset);
    offset += LENGTH_FIELD_BYTES;
    if (offset + length > envelope.length) return null;
    const field = envelope.slice(offset, offset + length);
    offset += length;
    return field;
  };

  const keyRef = readField();
  if (keyRef === null) return null;
  const wrapped = readField();
  if (wrapped === null) return null;
  if (offset + NONCE_LENGTH + TAG_LENGTH > envelope.length) return null;
  const nonce = envelope.slice(offset, offset + NONCE_LENGTH);
  const sealed = envelope.slice(offset + NONCE_LENGTH);
  return { keyRef, wrapped, nonce, sealed };
}
