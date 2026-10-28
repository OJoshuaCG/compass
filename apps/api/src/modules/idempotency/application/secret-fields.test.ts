import { describe, expect, it } from 'vitest';

import { carriesSecretField } from './secret-fields.js';

describe('carriesSecretField', () => {
  it('accepts the responses of the current idempotent routes', () => {
    expect(
      carriesSecretField({ id: 'a', email: 'a@example.test', rank: 2, expiresAt: '2026-01-01' }),
    ).toBe(false);
  });

  it.each([
    { initialPassword: 'x' },
    { totpSecret: 'x' },
    { recoveryCodes: ['x'] },
    { emergencyCodes: ['x'] },
    { inviteToken: 'x' },
    { nested: { items: [{ privateKey: 'x' }] } },
    { private_key: 'x' },
    { 'private-key': 'x' },
    { passphrase: 'x' },
    { apiKey: 'x' },
  ])('rejects a response that carries a secret-looking field: %j', (body) => {
    expect(carriesSecretField(body)).toBe(true);
  });

  it('is case-insensitive on field names', () => {
    expect(carriesSecretField({ PASSWORD: 'x' })).toBe(true);
  });

  it('treats a body too deep to inspect as unsafe', () => {
    let body: unknown = { ok: true };
    for (let level = 0; level < 12; level += 1) body = { child: body };
    expect(carriesSecretField(body)).toBe(true);
  });

  it('accepts primitives and null', () => {
    expect(carriesSecretField(null)).toBe(false);
    expect(carriesSecretField('text')).toBe(false);
    expect(carriesSecretField(42)).toBe(false);
  });
});
