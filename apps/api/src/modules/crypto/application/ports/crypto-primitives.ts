export interface AeadInput {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly aad: Uint8Array;
}

/**
 * Primitivas criptográficas. Es el único punto que toca `node:crypto`
 * (la implementación vive en `infrastructure`).
 */
export interface CryptoPrimitives {
  randomBytes(length: number): Uint8Array;
  /** AES-256-GCM. Devuelve `texto cifrado || etiqueta de 16 bytes`. */
  aesGcmEncrypt(input: AeadInput & { readonly plaintext: Uint8Array }): Uint8Array;
  /** Lanza si la autenticación falla (AAD, clave, nonce o texto alterados). */
  aesGcmDecrypt(input: AeadInput & { readonly ciphertext: Uint8Array }): Uint8Array;
  hkdfSha256(input: {
    readonly ikm: Uint8Array;
    readonly info: Uint8Array;
    readonly length: number;
    readonly salt?: Uint8Array;
  }): Uint8Array;
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
}
