import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import { clientSecretContext, packClientSecret, unpackClientSecret } from './client-secret.js';

describe('client secret packing', () => {
  it('ida y vuelta conservan versión, nonce y texto cifrado', () => {
    const secret = {
      dekVersion: 7,
      nonce: new Uint8Array(12).fill(3),
      ciphertext: new Uint8Array(40).fill(9),
    };
    expect(unpackClientSecret(packClientSecret(secret))).toEqual(secret);
  });

  it('rechaza valores demasiado cortos', () => {
    expect(unpackClientSecret(new Uint8Array(10))).toBeNull();
  });

  it('el contexto ata el secreto a su fila de cliente', () => {
    const org = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
    expect(clientSecretContext(org, 'row-1')).not.toEqual(clientSecretContext(org, 'row-2'));
  });
});
