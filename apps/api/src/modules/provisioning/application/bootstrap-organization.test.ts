import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BootstrapOrganization } from './bootstrap-organization.js';
import type { OrganizationSeeder } from './bootstrap-organization.js';

function setup() {
  const seeded: { rootPasswordHash: string }[] = [];
  const seeder: OrganizationSeeder = {
    seed: (input) => {
      seeded.push(input);
      return Promise.resolve();
    },
  };
  let counter = 0;
  const useCase = new BootstrapOrganization({
    seeder,
    hasher: {
      hash: (plain) => Promise.resolve(`hash:${plain}`),
      verify: () => Promise.resolve(true),
    },
    strength: { score: () => 4 },
    ids: { next: () => `id-${String((counter += 1))}` },
    randomBytes: (length) => randomBytes(length),
  });
  return { useCase, seeded };
}

const base = { name: 'Org', slug: 'org', rootEmail: 'root@org.test', rootDisplayName: 'Root' };

describe('BootstrapOrganization', () => {
  it('genera una contraseña inicial legible, la devuelve una vez y solo guarda su hash', async () => {
    const { useCase, seeded } = setup();
    const result = await useCase.execute(base);
    expect(result.initialPassword).toMatch(/^([a-zA-Z2-9]{6}-){3}[a-zA-Z2-9]{6}$/);
    expect(result.initialPassword).not.toMatch(/[01OIl]/);
    expect(seeded[0]?.rootPasswordHash).toBe(`hash:${result.initialPassword ?? ''}`);
  });

  it('no repite contraseñas entre altas', async () => {
    const { useCase } = setup();
    const a = await useCase.execute(base);
    const b = await useCase.execute(base);
    expect(a.initialPassword).not.toBe(b.initialPassword);
  });

  it('con contraseña explícita no devuelve ninguna inicial', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      ...base,
      rootPassword: 'Correct-Horse-Battery-Staple-9',
    });
    expect(result.initialPassword).toBeNull();
  });
});
