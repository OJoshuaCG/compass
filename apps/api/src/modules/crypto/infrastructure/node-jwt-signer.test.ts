import { createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { NodeSigningKeyGenerator } from './node-signing-key-generator.js';
import { NodeJwtSigner } from './node-jwt-signer.js';

const decode = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;

function signerWith(algorithm: 'ES256' | 'RS256') {
  const key = new NodeSigningKeyGenerator().generate(algorithm);
  const signer = new NodeJwtSigner({
    loadKeySet: () =>
      Promise.resolve({ privateJwks: [key.privateJwk], publicJwks: [key.publicJwk] }),
  });
  return { key, signer };
}

describe('NodeJwtSigner', () => {
  it.each(['ES256', 'RS256'] as const)(
    'produce un JWS %s con cabecera typ/kid y firma verificable con la clave pública',
    async (algorithm) => {
      const { key, signer } = signerWith(algorithm);
      const token = await signer.sign(
        { iss: 'https://compass.example.com', sid: 's1' },
        'logout+jwt',
      );
      const [header, payload, signature] = token.split('.') as [string, string, string];
      expect(decode(header)).toEqual({ alg: algorithm, kid: key.kid, typ: 'logout+jwt' });
      expect(decode(payload)).toEqual({ iss: 'https://compass.example.com', sid: 's1' });

      const publicKey = createPublicKey({ key: key.publicJwk, format: 'jwk' });
      const valid = verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        algorithm === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey,
        Buffer.from(signature, 'base64url'),
      );
      expect(valid).toBe(true);
    },
  );

  it('una firma manipulada no verifica', async () => {
    const { key, signer } = signerWith('ES256');
    const token = await signer.sign({ sid: 's1' }, 'logout+jwt');
    const [header, , signature] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ sid: 'otra' })).toString('base64url');
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${forged}`),
      { key: createPublicKey({ key: key.publicJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(false);
  });

  it('sin clave activa se niega a firmar', async () => {
    const signer = new NodeJwtSigner({
      loadKeySet: () => Promise.resolve({ privateJwks: [], publicJwks: [] }),
    });
    await expect(signer.sign({}, 'logout+jwt')).rejects.toThrow('no active signing key');
  });

  it('rechaza un algoritmo que no sea ES256 ni RS256', async () => {
    const signer = new NodeJwtSigner({
      loadKeySet: () =>
        Promise.resolve({ privateJwks: [{ alg: 'none', kid: 'k' }], publicJwks: [] }),
    });
    await expect(signer.sign({}, 'logout+jwt')).rejects.toThrow('Unsupported signing algorithm');
  });
});
