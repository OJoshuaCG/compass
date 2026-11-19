/**
 * Firma de JWT con la clave activa del emisor (JWS compacto). Único lugar fuera del proveedor OIDC donde se
 * usa una clave de firma privada.
 *
 * Invariantes de seguridad
 * - La clave se abre en cada firma (`loadKeySet`), así una rotación o un retiro se respetan sin reiniciar.
 * - Solo ES256 y RS256; el algoritmo sale de la propia clave, nunca de quien llama.
 * - La clave privada nunca se devuelve ni entra en un error.
 */
import { createPrivateKey, sign } from 'node:crypto';

import type { SigningKeySet } from '../application/signing-key-service.js';

const encodeSegment = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export class NodeJwtSigner {
  constructor(private readonly keys: { loadKeySet(): Promise<SigningKeySet> }) {}

  /** Firma `claims` con la primera clave activa. `type` va en la cabecera `typ` (p. ej. `logout+jwt`). */
  async sign(claims: Readonly<Record<string, unknown>>, type: string): Promise<string> {
    const { privateJwks } = await this.keys.loadKeySet();
    const jwk = privateJwks[0];
    if (jwk === undefined) {
      throw new Error('There is no active signing key');
    }
    const algorithm = jwk['alg'];
    if (algorithm !== 'ES256' && algorithm !== 'RS256') {
      throw new Error('Unsupported signing algorithm');
    }
    const signingInput = `${encodeSegment({ alg: algorithm, kid: jwk['kid'], typ: type })}.${encodeSegment(claims)}`;
    const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    const signature =
      algorithm === 'ES256'
        ? sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' })
        : sign('sha256', Buffer.from(signingInput), privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }
}
