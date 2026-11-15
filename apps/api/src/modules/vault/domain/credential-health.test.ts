import { describe, expect, it } from 'vitest';

import { evaluateCredentialHealth, summarizeCredentialHealth } from './credential-health.js';
import type { CredentialHealthFacts } from './credential-health.js';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const healthyFacts: CredentialHealthFacts = {
  credentialId: 'cred-1',
  strengthScore: 4,
  reusedByOtherCredentials: 0,
  lastChangedAt: new Date(NOW.getTime() - 10 * DAY_MS),
  platformSupportsTotp: true,
  totpState: 'verified',
  totpExposed: false,
  hasOpenRotationTask: false,
};

const signalsOf = (overrides: Partial<CredentialHealthFacts>) =>
  evaluateCredentialHealth({ ...healthyFacts, ...overrides }, NOW).signals;

describe('evaluateCredentialHealth', () => {
  it('no marca nada en una credencial sana', () => {
    expect(signalsOf({})).toEqual([]);
  });

  it('marca débil con puntaje 0 a 2 y no con 3; null (desconocido) no marca', () => {
    expect(signalsOf({ strengthScore: 2 })).toEqual(['weak_password']);
    expect(signalsOf({ strengthScore: 0 })).toEqual(['weak_password']);
    expect(signalsOf({ strengthScore: 3 })).toEqual([]);
    expect(signalsOf({ strengthScore: null })).toEqual([]);
  });

  it('marca reutilizada si otra credencial comparte la huella', () => {
    expect(signalsOf({ reusedByOtherCredentials: 1 })).toEqual(['reused_password']);
  });

  it('marca antigua solo pasados 90 días (estricto)', () => {
    expect(signalsOf({ lastChangedAt: new Date(NOW.getTime() - 90 * DAY_MS) })).toEqual([]);
    expect(signalsOf({ lastChangedAt: new Date(NOW.getTime() - 91 * DAY_MS) })).toEqual([
      'stale_password',
    ]);
  });

  it('distingue segundo factor faltante, pendiente y retirado', () => {
    expect(signalsOf({ totpState: null })).toEqual(['totp_missing']);
    expect(signalsOf({ totpState: 'retired' })).toEqual(['totp_missing']);
    expect(signalsOf({ totpState: 'pending' })).toEqual(['totp_pending']);
  });

  it('no acusa falta de segundo factor si la plataforma no lo admite', () => {
    expect(signalsOf({ platformSupportsTotp: false, totpState: null })).toEqual([]);
  });

  it('marca secreto expuesto y rotación pendiente', () => {
    expect(signalsOf({ totpExposed: true })).toEqual(['totp_exposed']);
    expect(signalsOf({ hasOpenRotationTask: true })).toEqual(['rotation_pending']);
  });

  it('devuelve el puntaje y nunca otros datos de la credencial', () => {
    const result = evaluateCredentialHealth({ ...healthyFacts, strengthScore: 1 }, NOW);
    expect(Object.keys(result).sort()).toEqual(['credentialId', 'signals', 'strengthScore']);
    expect(result.strengthScore).toBe(1);
  });
});

describe('summarizeCredentialHealth', () => {
  it('cuenta cada credencial una vez por señal y las que tienen al menos una', () => {
    const summary = summarizeCredentialHealth([
      { credentialId: 'a', signals: ['weak_password', 'stale_password'], strengthScore: 1 },
      { credentialId: 'b', signals: ['stale_password'], strengthScore: null },
      { credentialId: 'c', signals: [], strengthScore: 4 },
    ]);

    expect(summary.credentials).toBe(3);
    expect(summary.withSignals).toBe(2);
    expect(summary.strengthUnknown).toBe(1);
    expect(summary.bySignal.weak_password).toBe(1);
    expect(summary.bySignal.stale_password).toBe(2);
    expect(summary.bySignal.totp_exposed).toBe(0);
  });

  it('devuelve ceros, sin fallar, cuando no hay credenciales', () => {
    const summary = summarizeCredentialHealth([]);

    expect(summary.credentials).toBe(0);
    expect(Object.values(summary.bySignal).every((count) => count === 0)).toBe(true);
  });
});
