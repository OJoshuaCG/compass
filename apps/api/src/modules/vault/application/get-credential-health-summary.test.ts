import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import { GetCredentialHealthSummary } from './get-credential-health-summary.js';
import type { GetCredentialHealthSummaryDeps } from './get-credential-health-summary.js';
import type { CredentialHealthFacts } from '../domain/credential-health.js';

const GROUP_ID = '0198dddd-0000-7000-8000-000000000001';
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

interface BuildOptions {
  readonly rank: Rank;
  readonly roleInGroup?: 'manager' | 'member' | null;
  readonly groupExists?: boolean;
  readonly permissionDenied?: boolean;
}

function build(options: BuildOptions) {
  const factsByGroup = vi.fn(() => Promise.resolve([weakFacts]));
  const factsByOrganization = vi.fn(() => Promise.resolve([weakFacts, weakFacts]));
  const auditDenial = vi.fn(() => Promise.resolve());
  const deps = {
    uow: { run: <T>(fn: () => Promise<T>) => fn() },
    authorizer: {
      require: () =>
        options.permissionDenied === true
          ? Promise.reject(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'))
          : Promise.resolve([]),
      requireActiveMember: () => Promise.resolve({ id: 'actor-1', rank: options.rank }),
      auditDenial,
    },
    groups: {
      findLive: () =>
        Promise.resolve(options.groupExists === false ? null : { id: GROUP_ID, name: 'Soporte' }),
      roleOf: () => Promise.resolve(options.roleInGroup ?? null),
    },
    health: { factsByGroup, factsByOrganization },
    clock: { now: () => NOW },
  } as unknown as GetCredentialHealthSummaryDeps;
  return {
    useCase: new GetCredentialHealthSummary(deps),
    factsByGroup,
    factsByOrganization,
    auditDenial,
  };
}

describe('GetCredentialHealthSummary.forOrganization', () => {
  it('devuelve solo conteos a un Administrador', async () => {
    const { useCase } = build({ rank: 1 });

    const result = await useCase.forOrganization();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.credentials).toBe(2);
      expect(result.value.withSignals).toBe(2);
      expect(result.value.bySignal.weak_password).toBe(2);
      expect(Object.keys(result.value).sort()).toEqual([
        'bySignal',
        'credentials',
        'strengthUnknown',
        'withSignals',
      ]);
    }
  });

  it('niega y audita a un Líder aunque tenga el permiso, sin leer nada', async () => {
    const { useCase, factsByOrganization, auditDenial } = build({ rank: 2 });

    const result = await useCase.forOrganization();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.PERMISSION');
    expect(auditDenial).toHaveBeenCalledTimes(1);
    expect(factsByOrganization).not.toHaveBeenCalled();
  });

  it('propaga la negación del motor de autorización y no lee nada', async () => {
    const { useCase, factsByOrganization } = build({ rank: 1, permissionDenied: true });

    await expect(useCase.forOrganization()).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(factsByOrganization).not.toHaveBeenCalled();
  });
});

describe('GetCredentialHealthSummary.forGroup', () => {
  it('lo ve un Administrador aunque no sea miembro del grupo', async () => {
    const { useCase, factsByGroup } = build({ rank: 1, roleInGroup: null });

    const result = await useCase.forGroup(GROUP_ID);

    expect(result.ok).toBe(true);
    expect(factsByGroup).toHaveBeenCalledWith(GROUP_ID, NOW);
  });

  it('lo ve un Líder que gestiona el grupo', async () => {
    const { useCase } = build({ rank: 2, roleInGroup: 'manager' });

    expect((await useCase.forGroup(GROUP_ID)).ok).toBe(true);
  });

  it.each([
    ['un Líder que solo es miembro', 2, 'member'],
    ['un Líder ajeno al grupo', 2, null],
    ['un Operador marcado como gestor', 3, 'manager'],
  ] as const)('responde GROUP.NOT_FOUND y audita para %s', async (_label, rank, roleInGroup) => {
    const { useCase, factsByGroup, auditDenial } = build({ rank, roleInGroup });

    const result = await useCase.forGroup(GROUP_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GROUP.NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledTimes(1);
    expect(factsByGroup).not.toHaveBeenCalled();
  });

  it('responde GROUP.NOT_FOUND si el grupo no existe, igual que si no se puede ver', async () => {
    const { useCase, factsByGroup, auditDenial } = build({ rank: 1, groupExists: false });

    const result = await useCase.forGroup(GROUP_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GROUP.NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledTimes(1);
    expect(factsByGroup).not.toHaveBeenCalled();
  });

  it('propaga la negación del motor de autorización y no lee nada', async () => {
    const { useCase, factsByGroup } = build({ rank: 1, permissionDenied: true });

    await expect(useCase.forGroup(GROUP_ID)).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(factsByGroup).not.toHaveBeenCalled();
  });
});
