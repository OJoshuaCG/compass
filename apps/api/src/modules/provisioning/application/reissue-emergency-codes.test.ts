/**
 * SENSIBLE (ruta protegida: recuperación de la Raíz). Esta prueba la debe revisar una persona.
 */
import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EMERGENCY_CODE_COUNT } from '../../identity/index.js';
import { hashEmergencyCode } from './emergency-codes.js';
import {
  EmergencyCodeReissueRejectedError,
  ReissueEmergencyCodes,
} from './reissue-emergency-codes.js';
import type {
  ActiveRootIdentity,
  EmergencyCodeReissuePlan,
  EmergencyCodeReissueStore,
} from './reissue-emergency-codes.js';

const ROOT: ActiveRootIdentity = { organizationId: 'org-1', rootUserId: 'root-1' };

const primitives = {
  randomBytes: (length: number) => new Uint8Array(randomBytes(length)),
  sha256: (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest()),
};

function setup(options: { root?: ActiveRootIdentity | null; accepted?: boolean }) {
  const plans: EmergencyCodeReissuePlan[] = [];
  const store: EmergencyCodeReissueStore = {
    findActiveRoot: () => Promise.resolve(options.root === undefined ? ROOT : options.root),
    reissue: (plan) => {
      plans.push(plan);
      return Promise.resolve(options.accepted ?? true);
    },
  };
  return { plans, useCase: new ReissueEmergencyCodes({ store, primitives }) };
}

describe('ReissueEmergencyCodes', () => {
  it('issues the full set split evenly between the two custody groups', async () => {
    const { useCase, plans } = setup({});

    const result = await useCase.execute({ organizationSlug: 'acme' });

    expect(result.emergencyCodes).toHaveLength(EMERGENCY_CODE_COUNT);
    const groupA = result.emergencyCodeGroups.filter((group) => group === 'A');
    const groupB = result.emergencyCodeGroups.filter((group) => group === 'B');
    expect(groupA).toHaveLength(EMERGENCY_CODE_COUNT / 2);
    expect(groupB).toHaveLength(EMERGENCY_CODE_COUNT / 2);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.root).toEqual(ROOT);
  });

  it('hands the store only hashes that match the printed codes, never the codes', async () => {
    const { useCase, plans } = setup({});

    const result = await useCase.execute({ organizationSlug: 'acme' });

    const stored = plans[0]?.newEmergencyCodes ?? [];
    expect(JSON.stringify(stored)).not.toContain(result.emergencyCodes[0] ?? 'unreachable');
    result.emergencyCodes.forEach((code, index) => {
      expect(stored[index]?.hash).toEqual(hashEmergencyCode(code, primitives.sha256));
      expect(stored[index]?.custodyGroup).toBe(result.emergencyCodeGroups[index]);
    });
  });

  it('is rejected when the organization has no single active Root', async () => {
    const { useCase, plans } = setup({ root: null });

    await expect(useCase.execute({ organizationSlug: 'acme' })).rejects.toBeInstanceOf(
      EmergencyCodeReissueRejectedError,
    );
    expect(plans).toHaveLength(0);
  });

  it('is rejected, without returning any code, when the store refuses because live codes remain', async () => {
    const { useCase } = setup({ accepted: false });

    await expect(useCase.execute({ organizationSlug: 'acme' })).rejects.toBeInstanceOf(
      EmergencyCodeReissueRejectedError,
    );
  });
});
