import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { OidcClientRecord } from '../domain/oidc-client.js';
import { ManageOidcClients } from './manage-oidc-clients.js';
import type { RegisterOidcClientInput } from './manage-oidc-clients.js';
import type { NewOidcClient, OidcClientStore } from './ports/oidc-client-store.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTOR_ID = 'user-1' as UserId;
const NOW = new Date('2026-11-18T10:00:00.000Z');

const VALID_INPUT: RegisterOidcClientInput = {
  name: 'Grafana',
  redirectUris: ['https://grafana.example.com/login/generic_oauth'],
};

function recordFrom(client: NewOidcClient): OidcClientRecord {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    redirectUris: client.redirectUris,
    postLogoutRedirectUris: client.postLogoutRedirectUris,
    backchannelLogoutUri: client.backchannelLogoutUri,
    allowPrivateNetworkBackchannel: client.allowPrivateNetworkBackchannel,
    allowRefreshTokens: client.allowRefreshTokens,
    refreshJustification: client.refreshJustification,
    isExternal: client.isExternal,
    maxRank: client.maxRank,
    status: 'active',
    createdAt: NOW,
  };
}

interface Options {
  readonly deniedPermissions?: readonly string[];
  readonly existing?: OidcClientRecord | null;
  readonly insertConflict?: boolean;
}

function buildHarness(options: Options = {}) {
  const inserted: NewOidcClient[] = [];
  const existing =
    options.existing === undefined
      ? recordFrom({
          id: 'row-1',
          clientId: 'cmp_existing',
          name: 'Grafana',
          secretCiphertext: new Uint8Array(),
          redirectUris: ['https://grafana.example.com/cb'],
          postLogoutRedirectUris: [],
          backchannelLogoutUri: null,
          allowPrivateNetworkBackchannel: false,
          allowRefreshTokens: false,
          refreshJustification: null,
          isExternal: false,
          maxRank: null,
          createdBy: 'user-1',
        })
      : options.existing;
  const insert = vi.fn((client: NewOidcClient) => {
    inserted.push(client);
    return Promise.resolve(options.insertConflict === true ? null : recordFrom(client));
  });
  const replaceSecret = vi.fn<OidcClientStore['replaceSecret']>(() => Promise.resolve());
  const disable = vi.fn((id: string) =>
    Promise.resolve({ ...(existing as OidcClientRecord), id, status: 'disabled' as const }),
  );
  const clients: OidcClientStore = {
    insert,
    list: () => Promise.resolve([]),
    findForUpdate: () => Promise.resolve(existing),
    replaceSecret,
    disable,
  };
  const require = vi.fn((input: { permission: string }) =>
    options.deniedPermissions?.includes(input.permission) === true
      ? Promise.reject(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'))
      : Promise.resolve([]),
  );
  const audit = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
  const encrypt = vi.fn<(context: unknown, plaintext: Uint8Array) => Promise<unknown>>(() =>
    Promise.resolve({
      ok: true as const,
      value: {
        ciphertext: new Uint8Array(32).fill(5),
        nonce: new Uint8Array(12).fill(6),
        dekVersion: 1,
      },
    }),
  );
  let counter = 0;
  const useCase = new ManageOidcClients({
    context: {
      current: () => ({
        organizationId: ORGANIZATION_ID,
        actorId: ACTOR_ID,
        requestId: 'req-1',
        reauthAt: NOW,
        sessionId: 'session-1',
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require, actorPermissions: () => Promise.resolve(new Set()) } as never,
    clients,
    cipher: { encrypt } as never,
    random: {
      randomBytes: (length: number) => {
        counter += 1;
        return new Uint8Array(length).fill(counter);
      },
    },
    newId: () => 'new-row-id',
    audit: { record: audit } as never,
    clock: { now: () => NOW },
  });
  return { useCase, insert, replaceSecret, disable, inserted, require, audit, encrypt };
}

describe('ManageOidcClients.register', () => {
  it('exige sso.clients.manage antes de leer o escribir nada', async () => {
    const h = buildHarness({ deniedPermissions: ['sso.clients.manage'] });
    await expect(h.useCase.register(VALID_INPUT)).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('devuelve el secreto una vez y guarda solo su sobre cifrado', async () => {
    const h = buildHarness();
    const result = await h.useCase.register(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clientSecret.length).toBeGreaterThanOrEqual(40);
    const stored = h.inserted[0];
    expect(stored?.clientId).toMatch(/^cmp_[A-Za-z0-9_-]+$/);
    expect(stored?.clientId).toMatch(/^[A-Za-z0-9._~-]{8,64}$/);
    // El valor guardado no contiene el secreto en claro.
    const stash = Buffer.from(stored?.secretCiphertext ?? []).toString('latin1');
    expect(stash).not.toContain(result.value.clientSecret);
    expect(h.encrypt).toHaveBeenCalledTimes(1);
  });

  it('el audit lleva el client_id público y nunca el secreto ni las URI', async () => {
    const h = buildHarness();
    const result = await h.useCase.register(VALID_INPUT);
    if (!result.ok) throw result.error;
    const event = h.audit.mock.calls[0]?.[0];
    expect(event?.action).toBe('oidc_client.created');
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(result.value.clientSecret);
    expect(serialized).not.toContain('grafana.example.com');
    expect(serialized).toContain(result.value.client.clientId);
  });

  it('permite refresh solo con justificación', async () => {
    const withReason = await buildHarness().useCase.register({
      ...VALID_INPUT,
      refreshJustification: 'La consola necesita sesiones de varias horas',
    });
    expect(withReason.ok && withReason.value.client.allowRefreshTokens).toBe(true);
    const without = await buildHarness().useCase.register(VALID_INPUT);
    expect(without.ok && without.value.client.allowRefreshTokens).toBe(false);
  });

  it('el aviso back-channel a red privada exige además org.settings (solo Raíz)', async () => {
    const denied = buildHarness({ deniedPermissions: ['org.settings'] });
    await expect(
      denied.useCase.register({ ...VALID_INPUT, allowPrivateNetworkBackchannel: true }),
    ).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(denied.insert).not.toHaveBeenCalled();

    const allowed = buildHarness();
    const result = await allowed.useCase.register({
      ...VALID_INPUT,
      allowPrivateNetworkBackchannel: true,
    });
    expect(result.ok).toBe(true);
    expect(allowed.require).toHaveBeenCalledWith({ permission: 'org.settings' });
  });

  it('sin la bandera privada no pide org.settings', async () => {
    const h = buildHarness();
    await h.useCase.register(VALID_INPUT);
    expect(h.require).not.toHaveBeenCalledWith({ permission: 'org.settings' });
  });

  it.each([
    ['name', { name: '  ' }],
    ['redirectUris', { redirectUris: [] }],
    ['redirectUris', { redirectUris: ['http://app.example.com/cb'] }],
    ['postLogoutRedirectUris', { postLogoutRedirectUris: ['https://*.example.com/'] }],
    ['backchannelLogoutUri', { backchannelLogoutUri: 'ftp://x.example.com' }],
    ['refreshJustification', { refreshJustification: 'corto' }],
    ['maxRank', { maxRank: 7 }],
  ])('rechaza %s inválido antes de cifrar o escribir', async (field, patch) => {
    const h = buildHarness();
    const result = await h.useCase.register({ ...VALID_INPUT, ...patch });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION.FAILED');
    expect(result.error.meta).toMatchObject({ field });
    expect(h.encrypt).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('un fallo de cifrado se lanza para revertir y no escribe', async () => {
    const h = buildHarness();
    h.encrypt.mockResolvedValueOnce({
      ok: false,
      error: new DomainError('CRYPTO.KMS_UNAVAILABLE', 'down'),
    });
    await expect(h.useCase.register(VALID_INPUT)).rejects.toMatchObject({
      code: 'CRYPTO.KMS_UNAVAILABLE',
    });
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('un choque de client_id responde con error y no audita', async () => {
    const h = buildHarness({ insertConflict: true });
    const result = await h.useCase.register(VALID_INPUT);
    expect(result.ok).toBe(false);
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('ManageOidcClients.rotateSecret y disable', () => {
  it('rotar entrega un secreto nuevo, reemplaza el cifrado y audita sin el secreto', async () => {
    const h = buildHarness();
    const result = await h.useCase.rotateSecret('row-1');
    if (!result.ok) throw result.error;
    expect(h.replaceSecret).toHaveBeenCalledWith('row-1', expect.any(Uint8Array));
    expect(JSON.stringify(h.audit.mock.calls[0]?.[0])).not.toContain(result.value.clientSecret);
    expect(h.audit.mock.calls[0]?.[0].action).toBe('oidc_client.secret_rotated');
  });

  it('un cliente inexistente responde NOT_FOUND y uno deshabilitado no se modifica', async () => {
    const missing = await buildHarness({ existing: null }).useCase.rotateSecret('x');
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');

    const active = buildHarness();
    const found = await active.useCase.rotateSecret('row-1');
    if (!found.ok) throw found.error;
    const disabled = await buildHarness({
      existing: { ...found.value.client, status: 'disabled' },
    }).useCase.disable('row-1');
    expect(!disabled.ok && disabled.error.code).toBe('FEDERATION.CLIENT_DISABLED');
  });

  it('deshabilitar audita y exige el permiso', async () => {
    const h = buildHarness();
    const result = await h.useCase.disable('row-1');
    expect(result.ok).toBe(true);
    expect(h.audit.mock.calls[0]?.[0].action).toBe('oidc_client.disabled');

    const denied = buildHarness({ deniedPermissions: ['sso.clients.manage'] });
    await expect(denied.useCase.disable('row-1')).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });
    expect(denied.disable).not.toHaveBeenCalled();
  });
});
