import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId } from '../../../shared/kernel/index.js';
import { packClientSecret } from '../domain/client-secret.js';
import type {
  OidcClientSecretStore,
  StaleOidcClientSecret,
} from './ports/oidc-client-secret-store.js';
import { ReencryptOidcClientSecrets } from './reencrypt-oidc-client-secrets.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTIVE_DEK_VERSION = 3;
const OLD_DEK_VERSION = 1;
const FIRST_CLIENT_ROW_ID = '0190aaaa-0000-7000-8000-000000000001';
const SECOND_CLIENT_ROW_ID = '0190aaaa-0000-7000-8000-000000000002';

function staleSecret(clientRowId: string): StaleOidcClientSecret {
  return {
    clientRowId,
    packedSecret: packClientSecret({
      dekVersion: OLD_DEK_VERSION,
      nonce: new Uint8Array(12),
      ciphertext: new Uint8Array(20),
    }),
  };
}

function buildHarness(options: {
  stale: readonly StaleOidcClientSecret[];
  resealResults?: unknown[];
  replaceResults?: boolean[];
}) {
  const resealResults = [...(options.resealResults ?? [])];
  const replaceResults = [...(options.replaceResults ?? [])];
  const reseal = vi.fn(() =>
    Promise.resolve(
      resealResults.shift() ?? {
        ok: true,
        value: {
          ciphertext: new Uint8Array(20).fill(9),
          nonce: new Uint8Array(12),
          dekVersion: ACTIVE_DEK_VERSION,
        },
      },
    ),
  );
  const replaceSecretIfUnchanged = vi.fn(() => Promise.resolve(replaceResults.shift() ?? true));
  const lockSecretsBelowVersion = vi.fn(() => Promise.resolve(options.stale));
  const store: OidcClientSecretStore = {
    lockSecretsBelowVersion,
    replaceSecretIfUnchanged,
    countSecretsBelowVersion: vi.fn(() => Promise.resolve(7)),
  };
  const cipher = {
    activeVersion: vi.fn(() => Promise.resolve({ ok: true, value: ACTIVE_DEK_VERSION })),
    reseal,
  };
  const reencryptor = new ReencryptOidcClientSecrets({
    store,
    cipher: cipher as unknown as ConstructorParameters<
      typeof ReencryptOidcClientSecrets
    >[0]['cipher'],
  });
  return { reencryptor, lockSecretsBelowVersion, reseal, replaceSecretIfUnchanged };
}

describe('ReencryptOidcClientSecrets', () => {
  it('recifra con el contexto de su fila y guarda el valor empaquetado con la versión activa', async () => {
    const { reencryptor, reseal, replaceSecretIfUnchanged } = buildHarness({
      stale: [staleSecret(FIRST_CLIENT_ROW_ID)],
    });

    const result = await reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toEqual({
      resealed: 1,
      conflicts: 0,
      failed: 0,
      examined: 1,
      lastId: FIRST_CLIENT_ROW_ID,
    });
    expect(reseal).toHaveBeenCalledWith(
      {
        organizationId: ORGANIZATION_ID,
        resourceId: FIRST_CLIENT_ROW_ID,
        field: 'oidc_client_secret',
        version: 1,
      },
      expect.objectContaining({ dekVersion: OLD_DEK_VERSION }),
    );
    const [rowId, expected, replacement] = replaceSecretIfUnchanged.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      Uint8Array,
    ];
    expect(rowId).toBe(FIRST_CLIENT_ROW_ID);
    expect(new DataView(expected.buffer, expected.byteOffset).getUint32(0)).toBe(OLD_DEK_VERSION);
    expect(new DataView(replacement.buffer, replacement.byteOffset).getUint32(0)).toBe(
      ACTIVE_DEK_VERSION,
    );
  });

  it('cuenta como fallo un valor con formato inesperado, sin intentar abrirlo, y sigue con el siguiente', async () => {
    const { reencryptor, reseal } = buildHarness({
      stale: [
        { clientRowId: FIRST_CLIENT_ROW_ID, packedSecret: new Uint8Array(5) },
        staleSecret(SECOND_CLIENT_ROW_ID),
      ],
    });

    const result = await reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toMatchObject({ resealed: 1, failed: 1, examined: 2 });
    expect(reseal).toHaveBeenCalledTimes(1);
  });

  it('cuenta como fallo un secreto que el cifrador no puede abrir y no lo reemplaza', async () => {
    const { reencryptor, replaceSecretIfUnchanged } = buildHarness({
      stale: [staleSecret(FIRST_CLIENT_ROW_ID)],
      resealResults: [{ ok: false, error: new Error('opaque') }],
    });

    const result = await reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toMatchObject({ resealed: 0, failed: 1 });
    expect(replaceSecretIfUnchanged).not.toHaveBeenCalled();
  });

  it('cuenta como conflicto la fila que otra escritura cambió y no la da por recifrada', async () => {
    const { reencryptor } = buildHarness({
      stale: [staleSecret(FIRST_CLIENT_ROW_ID)],
      replaceResults: [false],
    });

    const result = await reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toMatchObject({ resealed: 0, conflicts: 1 });
  });

  it('un lote sin filas termina el recorrido con lastId nulo', async () => {
    const { reencryptor } = buildHarness({ stale: [] });

    const result = await reencryptor.reencryptBatch(ORGANIZATION_ID, 10, null);

    expect(result).toMatchObject({ examined: 0, lastId: null });
  });

  it('reenvía el cursor al almacén y expone los pendientes', async () => {
    const { reencryptor, lockSecretsBelowVersion } = buildHarness({ stale: [] });

    await reencryptor.reencryptBatch(ORGANIZATION_ID, 5, FIRST_CLIENT_ROW_ID);

    expect(lockSecretsBelowVersion).toHaveBeenCalledWith(
      ACTIVE_DEK_VERSION,
      5,
      FIRST_CLIENT_ROW_ID,
    );
    expect(await reencryptor.countPending(ORGANIZATION_ID)).toBe(7);
  });
});
