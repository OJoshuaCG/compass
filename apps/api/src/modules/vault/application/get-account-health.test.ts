import { describe, expect, it, vi } from 'vitest';

import { asUserId } from '../../../shared/kernel/index.js';
import { GetAccountHealth } from './get-account-health.js';
import type { GetAccountHealthDeps } from './get-account-health.js';
import type { CredentialHealthFacts } from '../domain/credential-health.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const ACCOUNT_ID = '0198cccc-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-14T12:00:00.000Z');

const weakFacts: CredentialHealthFacts = {
  credentialId: 'cred-1',
  strengthScore: 1,
  reusedByOtherCredentials: 0,
  lastChangedAt: new Date('2026-11-10T00:00:00.000Z'),
  platformSupportsTotp: false,
  totpState: null,
  totpExposed: false,
  hasOpenRotationTask: false,
};

function build(options: { level: 'VIEW' | null; status?: 'active' | 'archived' }) {
  const factsByAccount = vi.fn(() => Promise.resolve([weakFacts]));
  const deps = {
    uow: { run: <T>(fn: () => Promise<T>) => fn() },
    authorizer: { requireActiveMember: () => Promise.resolve({ id: ACTOR_ID }) },
    accounts: {
      effectiveLevel: () => Promise.resolve(options.level),
      findById: () => Promise.resolve({ id: ACCOUNT_ID, status: options.status ?? 'active' }),
    },
    health: { factsByAccount },
    clock: { now: () => NOW },
  } as unknown as GetAccountHealthDeps;
  return { useCase: new GetAccountHealth(deps), factsByAccount };
}

describe('GetAccountHealth', () => {
  it('devuelve las señales de cada credencial a quien tiene acceso a la cuenta', async () => {
    const { useCase } = build({ level: 'VIEW' });

    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { credentialId: 'cred-1', signals: ['weak_password'], strengthScore: 1 },
      ]);
    }
  });

  it('responde NOT_FOUND sin leer nada si la persona no tiene acceso a la cuenta', async () => {
    const { useCase, factsByAccount } = build({ level: null });

    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(factsByAccount).not.toHaveBeenCalled();
  });

  it('responde NOT_FOUND si la cuenta está archivada', async () => {
    const { useCase, factsByAccount } = build({ level: 'VIEW', status: 'archived' });

    const result = await useCase.execute(ACCOUNT_ID);

    expect(result.ok).toBe(false);
    expect(factsByAccount).not.toHaveBeenCalled();
  });
});
