import { describe, expect, it } from 'vitest';

import { OtplibTotpEngine } from './otplib-totp-engine.js';

describe('OtplibTotpEngine', () => {
  it('declara a Compass como emisor en el URI de registro', () => {
    const engine = new OtplibTotpEngine();
    const secret = engine.generateSecret();

    const uri = engine.uri({ secret, accountLabel: 'ana@example.com' });
    const parsedUri = new URL(uri);

    // El emisor es lo que la app de autenticación muestra a la persona junto a su cuenta.
    expect(parsedUri.protocol).toBe('otpauth:');
    expect(parsedUri.host).toBe('totp');
    expect(parsedUri.searchParams.get('issuer')).toBe('Compass');
    expect(decodeURIComponent(parsedUri.pathname)).toBe('/Compass:ana@example.com');
  });
});
