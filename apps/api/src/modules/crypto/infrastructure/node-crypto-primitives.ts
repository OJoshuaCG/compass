/**
 * Invariantes de seguridad
 * - Único archivo (junto con sus hermanos de `infrastructure`) autorizado a importar `node:crypto`.
 * - AES-256-GCM con clave de 32 bytes, nonce de 12 bytes y etiqueta de 16 bytes; cualquier otra
 *   longitud se rechaza antes de tocar OpenSSL.
 * - La etiqueta se valida siempre antes de devolver texto en claro (GCM autenticado).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

import type { AeadInput, CryptoPrimitives } from '../application/ports/crypto-primitives.js';

const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

function assertAead({ key, nonce }: AeadInput): void {
  if (key.length !== KEY_LENGTH) throw new RangeError('AES-256-GCM requires a 32-byte key');
  if (nonce.length !== NONCE_LENGTH) throw new RangeError('AES-GCM requires a 12-byte nonce');
}

export class NodeCryptoPrimitives implements CryptoPrimitives {
  randomBytes(length: number): Uint8Array {
    return new Uint8Array(randomBytes(length));
  }

  aesGcmEncrypt(input: AeadInput & { readonly plaintext: Uint8Array }): Uint8Array {
    assertAead(input);
    const cipher = createCipheriv('aes-256-gcm', input.key, input.nonce, {
      authTagLength: TAG_LENGTH,
    });
    cipher.setAAD(input.aad);
    const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
    return new Uint8Array(Buffer.concat([body, cipher.getAuthTag()]));
  }

  aesGcmDecrypt(input: AeadInput & { readonly ciphertext: Uint8Array }): Uint8Array {
    assertAead(input);
    if (input.ciphertext.length < TAG_LENGTH) throw new RangeError('Ciphertext is too short');
    const split = input.ciphertext.length - TAG_LENGTH;
    const decipher = createDecipheriv('aes-256-gcm', input.key, input.nonce, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAAD(input.aad);
    decipher.setAuthTag(input.ciphertext.subarray(split));
    return new Uint8Array(
      Buffer.concat([decipher.update(input.ciphertext.subarray(0, split)), decipher.final()]),
    );
  }

  hkdfSha256(input: {
    readonly ikm: Uint8Array;
    readonly info: Uint8Array;
    readonly length: number;
    readonly salt?: Uint8Array;
  }): Uint8Array {
    return new Uint8Array(
      hkdfSync('sha256', input.ikm, input.salt ?? new Uint8Array(0), input.info, input.length),
    );
  }

  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
    return new Uint8Array(createHmac('sha256', key).update(data).digest());
  }

  sha256(data: Uint8Array): Uint8Array {
    return new Uint8Array(createHash('sha256').update(data).digest());
  }
}
