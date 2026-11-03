import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId } from '../../../shared/kernel/index.js';
import type {
  IntegrationSecretStore,
  StaleIntegrationSecret,
} from './ports/integration-secret-store.js';
import { ReencryptIntegrationSecrets } from './reencrypt-integration-secrets.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTIVE_DEK_VERSION = 3;
const OLD_DEK_VERSION = 1;
const FIRST_INTEGRATION_ID = '0190aaaa-0000-7000-8000-000000000001';
const SECOND_INTEGRATION_ID = '0190aaaa-0000-7000-8000-000000000002';

function staleSecret(
  integrationId: string,
  field: StaleIntegrationSecret['field'],
  secretVersion = 2,
): StaleIntegrationSecret {
  return {
    integrationId,
    field,
    secretVersion,
    ciphertext: new Uint8Array([1, 2, 3]),
    nonce: new Uint8Array(12),
    dekVersion: OLD_DEK_VERSION,
  };
}

interface Harness {
  readonly reencryptor: ReencryptIntegrationSecrets;
  readonly store: IntegrationSecretStore;
  readonly reseal: ReturnType<typeof vi.fn>;
  readonly replaceSecret: ReturnType<typeof vi.fn>;
}

function buildHarness(options: {
  stale: readonly StaleIntegrationSecret[];
  resealResults?: unknown[];
  replaceResults?: boolean[];
}): Harness {
  const resealResults = [...(options.resealResults ?? [])];
  const replaceResults = [...(options.replaceResults ?? [])];
  const reseal = vi.fn(() =>
    Promise.resolve(
      resealResults.shift() ?? {
        ok: true,
        value: {
          ciphertext: new Uint8Array([9, 9, 9]),
          nonce: new Uint8Array(12),
          dekVersion: ACTIVE_DEK_VERSION,
        },
      },
    ),
  );
  const replaceSecret = vi.fn(() => Promise.resolve(replaceResults.shift() ?? true));
  const store: IntegrationSecretStore = {
    lockSecretsBelowVersion: vi.fn(() => Promise.resolve(options.stale)),
    replaceSecret,
    countSecretsBelowVersion: vi.fn(() => Promise.resolve(7)),
  };
  const cipher = {
    activeVersion: vi.fn(() => Promise.resolve({ ok: true, value: ACTIVE_DEK_VERSION })),
    reseal,
  };
  const reencryptor = new ReencryptIntegrationSecrets({
    store,
    cipher: cipher as unknown as ConstructorParameters<
      typeof ReencryptIntegrationSecrets
    >[0]['cipher'],
  });
  return { reencryptor, store, reseal, replaceSecret };
}

describe('ReencryptIntegrationSecrets', () => {
  it('reseals each stale secret with its own context and reports the cursor of the last one', async () => {
    const harness = buildHarness({
      stale: [
        staleSecret(FIRST_INTEGRATION_ID, 'api_key', 4),
        staleSecret(SECOND_INTEGRATION_ID, 'bot_token', 2),
      ],
    });

    const result = await harness.reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toEqual({
      resealed: 2,
      conflicts: 0,
      failed: 0,
      examined: 2,
      lastId: `${SECOND_INTEGRATION_ID}:bot_token`,
    });
    expect(harness.reseal.mock.calls[0]?.[0]).toEqual({
      organizationId: ORGANIZATION_ID,
      resourceId: FIRST_INTEGRATION_ID,
      field: 'integration.api_key',
      version: 4,
    });
    expect(harness.replaceSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: FIRST_INTEGRATION_ID,
        field: 'api_key',
        expectedDekVersion: OLD_DEK_VERSION,
        expectedSecretVersion: 4,
        dekVersion: ACTIVE_DEK_VERSION,
      }),
    );
  });

  it('counts a lost race as a conflict and a failed reseal as a failure, and keeps going', async () => {
    const harness = buildHarness({
      stale: [
        staleSecret(FIRST_INTEGRATION_ID, 'api_key'),
        staleSecret(FIRST_INTEGRATION_ID, 'bot_token'),
        staleSecret(SECOND_INTEGRATION_ID, 'bot_token'),
      ],
      resealResults: [
        {
          ok: true,
          value: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12), dekVersion: 3 },
        },
        { ok: false, error: new Error('cannot open') },
      ],
      replaceResults: [false],
    });

    const result = await harness.reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toMatchObject({ resealed: 1, conflicts: 1, failed: 1, examined: 3 });
  });

  it('does not write when the secret is already on the active key', async () => {
    const harness = buildHarness({
      stale: [staleSecret(FIRST_INTEGRATION_ID, 'api_key')],
      resealResults: [{ ok: true, value: null }],
    });

    const result = await harness.reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(harness.replaceSecret).not.toHaveBeenCalled();
    expect(result).toMatchObject({ resealed: 0, conflicts: 0, failed: 0, examined: 1 });
  });

  it('returns no cursor when nothing is pending, and reports the pending count', async () => {
    const harness = buildHarness({ stale: [] });

    const result = await harness.reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result.lastId).toBeNull();
    expect(await harness.reencryptor.countPending(ORGANIZATION_ID)).toBe(7);
  });
});
