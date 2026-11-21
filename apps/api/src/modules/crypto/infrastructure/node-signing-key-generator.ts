/**
 * Invariantes de seguridad
 * - Solo ES256 (P-256) y RS256 (2048 bits como mínimo); cualquier otro algoritmo se rechaza.
 * - La clave privada se devuelve una sola vez, como JWK; este archivo no la guarda ni la registra.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import type {
  GeneratedSigningKey,
  Jwk,
  SigningAlgorithm,
  SigningKeyGenerator,
} from '../application/ports/signing-keys.js';

const KEY_ID_BYTES = 16;
const RSA_MODULUS_BITS = 2048;

export class NodeSigningKeyGenerator implements SigningKeyGenerator {
  generate(algorithm: SigningAlgorithm): GeneratedSigningKey {
    const kid = randomBytes(KEY_ID_BYTES).toString('base64url');
    const { publicKey, privateKey } =
      algorithm === 'ES256'
        ? generateKeyPairSync('ec', { namedCurve: 'P-256' })
        : generateKeyPairSync('rsa', { modulusLength: RSA_MODULUS_BITS });

    const metadata = { kid, alg: algorithm, use: 'sig' };
    const publicJwk: Jwk = { ...publicKey.export({ format: 'jwk' }), ...metadata };
    const privateJwk: Jwk = { ...privateKey.export({ format: 'jwk' }), ...metadata };
    return { kid, algorithm, publicJwk, privateJwk };
  }
}
