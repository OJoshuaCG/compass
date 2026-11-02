import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EMERGENCY_CODE_COUNT } from '../../identity/index.js';
import { BootstrapOrganization } from './bootstrap-organization.js';
import type { OrganizationSeeder } from './bootstrap-organization.js';
import { FirstRootSetup } from './first-root-setup.js';
import type { FirstSetupInput, FirstSetupRejection } from './first-root-setup.js';

/** Equivalente de `CryptoPrimitives.constantTimeEquals` para no depender del módulo de criptografía. */
const constantTimeEquals = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && timingSafeEqual(left, right);

const CONFIGURED_TOKEN = 'configured-token-with-more-than-32-characters';
const CLIENT_IP = '203.0.113.7';
const STRONG_PASSWORD = 'correct horse battery staple 2026';

const validInput: FirstSetupInput = {
  token: CONFIGURED_TOKEN,
  organizationName: 'Acme',
  organizationSlug: 'acme',
  rootEmail: 'Root@Example.Test',
  rootDisplayName: 'Rosa Raiz',
  password: STRONG_PASSWORD,
};

interface SetupOptions {
  readonly configuredToken?: string | undefined;
  readonly existingOrganizations?: number;
  readonly seederFailure?: Error;
  readonly passwordScore?: number;
}

function setup(options: SetupOptions = {}) {
  const seeded: Parameters<OrganizationSeeder['seed']>[0][] = [];
  const rejections: { reason: FirstSetupRejection; ip: string }[] = [];
  const seeder: OrganizationSeeder = {
    seed: (input) => {
      if (options.seederFailure !== undefined) return Promise.reject(options.seederFailure);
      seeded.push(input);
      return Promise.resolve();
    },
  };
  const strength = { score: () => options.passwordScore ?? 4 };
  let counter = 0;
  const sha256 = (data: Uint8Array): Uint8Array => createHash('sha256').update(data).digest();
  const useCase = new FirstRootSetup({
    configuredToken: 'configuredToken' in options ? options.configuredToken : CONFIGURED_TOKEN,
    organizations: {
      listIds: () =>
        Promise.resolve(Array.from({ length: options.existingOrganizations ?? 0 }, () => 'org')),
    },
    bootstrap: new BootstrapOrganization({
      seeder,
      hasher: {
        hash: (plain) => Promise.resolve(`hash:${plain}`),
        verify: () => Promise.resolve(true),
      },
      strength,
      ids: { next: () => `id-${String((counter += 1))}` },
      randomBytes: (length) => randomBytes(length),
      sha256,
    }),
    strength,
    sha256,
    constantTimeEquals,
    onRejected: (event) => rejections.push(event),
  });
  return { useCase, seeded, rejections };
}

describe('FirstRootSetup', () => {
  it('creates the organization and the Root with the chosen password and returns the emergency codes once', async () => {
    const { useCase, seeded } = setup();

    const result = await useCase.execute(validInput, CLIENT_IP);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({
      name: 'Acme',
      slug: 'acme',
      rootEmail: 'root@example.test',
      rootPasswordHash: `hash:${STRONG_PASSWORD}`,
      // La contraseña la eligió la persona: no se le obliga a cambiarla.
      rootPasswordMustChange: false,
    });
    expect(result.value.organizationId).toBe(seeded[0]?.organizationId);
    expect(result.value.emergencyCodes).toHaveLength(EMERGENCY_CODE_COUNT);
    expect(result.value.emergencyCodes.filter((code) => code.custodyGroup === 'A')).toHaveLength(
      EMERGENCY_CODE_COUNT / 2,
    );
    expect(result.value.emergencyCodes.filter((code) => code.custodyGroup === 'B')).toHaveLength(
      EMERGENCY_CODE_COUNT / 2,
    );
  });

  it.each([
    ['the token is not configured', { configuredToken: undefined }, validInput, 'not_configured'],
    ['the token is wrong', {}, { ...validInput, token: `${CONFIGURED_TOKEN}x` }, 'wrong_token'],
    [
      'an organization already exists',
      { existingOrganizations: 1 },
      validInput,
      'already_completed',
    ],
  ] as const)(
    'answers NOT_FOUND and creates nothing when %s',
    async (_name, options, input, reason) => {
      const { useCase, seeded, rejections } = setup(options);

      const result = await useCase.execute(input, CLIENT_IP);

      expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(seeded).toHaveLength(0);
      expect(rejections).toEqual([{ reason, ip: CLIENT_IP }]);
    },
  );

  it('gives the same answer for every kind of rejection', async () => {
    const answers = await Promise.all([
      setup({ configuredToken: undefined }).useCase.execute(validInput, CLIENT_IP),
      setup().useCase.execute({ ...validInput, token: 'z'.repeat(40) }, CLIENT_IP),
      setup({ existingOrganizations: 2 }).useCase.execute(validInput, CLIENT_IP),
    ]);
    const messages = answers.map((answer) => (answer.ok ? 'ok' : answer.error.message));
    expect(new Set(messages).size).toBe(1);
  });

  it('never reports the token or the password to the rejection hook', async () => {
    const { useCase, rejections } = setup();
    await useCase.execute(
      { ...validInput, token: 'a-wrong-token-that-is-long-enough-123' },
      CLIENT_IP,
    );
    const serialized = JSON.stringify(rejections);
    expect(serialized).not.toContain('a-wrong-token');
    expect(serialized).not.toContain(STRONG_PASSWORD);
    expect(serialized).not.toContain(CONFIGURED_TOKEN);
  });

  it('answers NOT_FOUND when the database reports the first organization already exists (lost race)', async () => {
    const { useCase, rejections } = setup({
      seederFailure: Object.assign(new Error('the first organization already exists'), {
        code: 'IAM01',
      }),
    });

    const result = await useCase.execute(validInput, CLIENT_IP);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(rejections).toEqual([{ reason: 'already_completed', ip: CLIENT_IP }]);
  });

  it('lets any other database failure propagate instead of disguising it as a closed route', async () => {
    const { useCase } = setup({ seederFailure: new Error('connection lost') });
    await expect(useCase.execute(validInput, CLIENT_IP)).rejects.toThrow('connection lost');
  });

  it('rejects a weak password with the policy code and creates nothing', async () => {
    const { useCase, seeded } = setup({ passwordScore: 1 });

    const result = await useCase.execute(validInput, CLIENT_IP);

    expect(result).toMatchObject({ ok: false, error: { code: 'PASSWORD.WEAK' } });
    expect(seeded).toHaveLength(0);
  });

  it('rejects a password that contains the Root email or name', async () => {
    const { useCase, seeded } = setup();

    const result = await useCase.execute(
      { ...validInput, password: 'rosa raiz is my favourite person ever' },
      CLIENT_IP,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'PASSWORD.CONTAINS_PERSONAL_DATA' } });
    expect(seeded).toHaveLength(0);
  });
});
