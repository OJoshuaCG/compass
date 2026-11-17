import { describe, expect, it } from 'vitest';

import { credentialHealthSchema } from './credentials.js';

const CREDENTIAL_ID = '0198bbbb-0000-7000-8000-000000000001';

describe('credentialHealthSchema', () => {
  it('acepta señales conocidas y un puntaje nulo (aún no medido)', () => {
    const parsed = credentialHealthSchema.safeParse({
      credentialId: CREDENTIAL_ID,
      signals: ['weak_password', 'totp_missing'],
      strengthScore: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza una señal desconocida y un puntaje fuera de 0 a 4', () => {
    expect(
      credentialHealthSchema.safeParse({
        credentialId: CREDENTIAL_ID,
        signals: ['unknown_signal'],
        strengthScore: 2,
      }).success,
    ).toBe(false);
    expect(
      credentialHealthSchema.safeParse({
        credentialId: CREDENTIAL_ID,
        signals: [],
        strengthScore: 5,
      }).success,
    ).toBe(false);
  });

  it('descarta cualquier campo extra, como un secreto que se colara por error', () => {
    const parsed = credentialHealthSchema.parse({
      credentialId: CREDENTIAL_ID,
      signals: [],
      strengthScore: 3,
      password: 'no-debe-salir',
    });
    expect(Object.keys(parsed).sort()).toEqual(['credentialId', 'signals', 'strengthScore']);
  });
});
