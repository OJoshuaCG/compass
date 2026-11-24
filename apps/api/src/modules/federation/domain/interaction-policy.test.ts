import { describe, expect, it } from 'vitest';

import { consentRequired, decideInteraction } from './interaction-policy.js';
import type { InteractionFacts } from './interaction-policy.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const STARTED = new Date('2026-11-18T11:59:00.000Z');
const ORG = 'org-1';

function facts(overrides: Partial<InteractionFacts> = {}): InteractionFacts {
  return {
    session: { userId: 'user-1', organizationId: ORG, mfaAt: new Date('2026-11-18T11:58:00.000Z') },
    clientOrganizationId: ORG,
    entryAllowed: true,
    now: NOW,
    interactionStartedAt: STARTED,
    promptNames: [],
    maxAgeSeconds: null,
    ...overrides,
  };
}

describe('decideInteraction', () => {
  it('pide iniciar sesión sin sesión de Compass', () => {
    expect(decideInteraction(facts({ session: null }))).toEqual({ kind: 'sign_in' });
  });

  it('pide iniciar sesión si la sesión nunca verificó el segundo factor', () => {
    const session = { userId: 'user-1', organizationId: ORG, mfaAt: null };
    expect(decideInteraction(facts({ session }))).toEqual({ kind: 'sign_in' });
  });

  it('niega a una persona de otra organización', () => {
    expect(decideInteraction(facts({ clientOrganizationId: 'org-2' }))).toEqual({ kind: 'deny' });
  });

  it('niega cuando el rango no alcanza', () => {
    expect(decideInteraction(facts({ entryAllowed: false }))).toEqual({ kind: 'deny' });
  });

  it('autentica y expone auth_time en segundos a partir de mfa_at', () => {
    expect(decideInteraction(facts())).toEqual({
      kind: 'authenticated',
      userId: 'user-1',
      authTimeSeconds: Math.floor(new Date('2026-11-18T11:58:00.000Z').getTime() / 1000),
    });
  });

  it('prompt=login exige un segundo factor posterior a la apertura de la interacción', () => {
    expect(decideInteraction(facts({ promptNames: ['login'] }))).toEqual({
      kind: 'reauthenticate',
    });
  });

  it('prompt=login acepta un segundo factor renovado tras abrir la interacción', () => {
    const session = {
      userId: 'user-1',
      organizationId: ORG,
      mfaAt: new Date('2026-11-18T11:59:30.000Z'),
    };
    expect(decideInteraction(facts({ promptNames: ['login'], session })).kind).toBe(
      'authenticated',
    );
  });

  it('max_age vencido fuerza reautenticación y vigente no', () => {
    // mfa_at hace 120 s.
    expect(decideInteraction(facts({ maxAgeSeconds: 60 }))).toEqual({ kind: 'reauthenticate' });
    expect(decideInteraction(facts({ maxAgeSeconds: 120 })).kind).toBe('authenticated');
  });

  it('la negación gana a la reautenticación', () => {
    expect(
      decideInteraction(facts({ entryAllowed: false, promptNames: ['login'], maxAgeSeconds: 1 })),
    ).toEqual({ kind: 'deny' });
  });
});

describe('consentRequired', () => {
  it('solo pregunta a la persona para clientes externos', () => {
    expect(consentRequired(true)).toBe(true);
    expect(consentRequired(false)).toBe(false);
  });
});
