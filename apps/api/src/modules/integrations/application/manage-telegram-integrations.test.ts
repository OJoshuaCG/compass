import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { EncryptedSecret } from '../../crypto/index.js';
import { ManageTelegramIntegrations } from './manage-telegram-integrations.js';
import type { ManageTelegramIntegrationsDeps } from './manage-telegram-integrations.js';
import type {
  IntegrationRecord,
  IntegrationRepository,
  StoredIntegrationSecret,
} from './ports/integration-repository.js';
import type { TelegramMessage, TelegramSendResult } from './ports/telegram-sender.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTOR_ID = 'user-1' as UserId;
const BOT_TOKEN = '123456789:AAFakeTokenForTestsOnly_0123456789abcd';
const NEW_BOT_TOKEN = '987654321:AAOtherFakeTokenForTestsOnly_9876543210';
const CHAT_ID = '-100200300';
const NOW = new Date('2026-11-03T10:00:00.000Z');

const ENCRYPTED: EncryptedSecret = {
  ciphertext: new Uint8Array([1, 2, 3]),
  nonce: new Uint8Array(12),
  dekVersion: 2,
};

function infraRecord(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    id: '0190aaaa-0000-7000-8000-000000000001',
    kind: 'telegram_infra',
    name: 'Alertas',
    status: 'active',
    chatId: CHAT_ID,
    hasBotToken: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface Options {
  readonly existing?: IntegrationRecord | null;
  readonly activeOfKind?: IntegrationRecord | null;
  readonly secret?: StoredIntegrationSecret | null;
  readonly allowedPermissions?: readonly string[];
  readonly sendResult?: TelegramSendResult;
  readonly decryptOk?: boolean;
}

function buildHarness(options: Options = {}) {
  const allowed = new Set(
    options.allowedPermissions ?? ['alerts.infra.manage', 'alerts.security.manage'],
  );
  const existing = options.existing === undefined ? infraRecord() : options.existing;

  const insert = vi.fn((input: { kind: IntegrationRecord['kind']; name: string; chatId: string }) =>
    Promise.resolve(infraRecord({ ...input, id: 'new-id', hasBotToken: false })),
  );
  const update = vi.fn((id: string, changes: { name: string; chatId: string }) =>
    Promise.resolve(infraRecord({ id, ...changes })),
  );
  const archive = vi.fn((id: string) => Promise.resolve(infraRecord({ id, status: 'archived' })));
  const putSecret = vi.fn<(secret: Record<string, unknown>) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const integrations: IntegrationRepository = {
    findForUpdate: vi.fn(() => Promise.resolve(existing)),
    findActiveByKind: vi.fn(() => Promise.resolve(options.activeOfKind ?? null)),
    listByKinds: vi.fn(() => Promise.resolve([infraRecord()])),
    insert,
    update,
    archive,
    findSecret: vi.fn(() =>
      Promise.resolve(
        options.secret === undefined ? { secretVersion: 4, encrypted: ENCRYPTED } : options.secret,
      ),
    ),
    putSecret,
  };

  const require = vi.fn(({ permission }: { permission: string }) => {
    if (!allowed.has(permission)) {
      return Promise.reject(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'));
    }
    return Promise.resolve([]);
  });
  const actorPermissions = vi.fn(() => Promise.resolve(allowed));
  const record = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
  const encrypt = vi.fn<
    (
      context: Record<string, unknown>,
      plaintext: Uint8Array,
    ) => Promise<{ ok: true; value: EncryptedSecret }>
  >(() => Promise.resolve({ ok: true as const, value: ENCRYPTED }));
  const decrypt = vi.fn(() =>
    Promise.resolve(
      options.decryptOk === false
        ? { ok: false as const, error: new DomainError('CRYPTO.DECRYPT_FAILED', 'cannot open') }
        : { ok: true as const, value: new TextEncoder().encode(BOT_TOKEN) },
    ),
  );
  const send = vi.fn<(message: TelegramMessage) => Promise<TelegramSendResult>>(() =>
    Promise.resolve(options.sendResult ?? { ok: true }),
  );

  const deps = {
    context: {
      current: () => ({
        organizationId: ORGANIZATION_ID,
        actorId: ACTOR_ID,
        requestId: 'req-1',
        reauthAt: NOW,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require, actorPermissions },
    integrations,
    cipher: { encrypt, decrypt },
    sender: { send },
    audit: { record },
    clock: { now: () => NOW },
  } as unknown as ManageTelegramIntegrationsDeps;

  return {
    useCase: new ManageTelegramIntegrations(deps),
    insert,
    update,
    archive,
    putSecret,
    require,
    record,
    encrypt,
    send,
  };
}

const createInput = {
  kind: 'telegram_infra',
  name: '  Alertas  ',
  chatId: CHAT_ID,
  botToken: BOT_TOKEN,
} as const;

describe('ManageTelegramIntegrations.create', () => {
  it('requires the permission of the channel kind, trims the name and stores the token as version 1', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.create(createInput);

    expect(harness.require).toHaveBeenCalledWith({ permission: 'alerts.infra.manage' });
    expect(harness.insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alertas', chatId: CHAT_ID, createdBy: ACTOR_ID }),
    );
    expect(harness.encrypt.mock.calls[0]?.[0]).toEqual({
      organizationId: ORGANIZATION_ID,
      resourceId: 'new-id',
      field: 'integration.bot_token',
      version: 1,
    });
    expect(harness.putSecret).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'bot_token', secretVersion: 1, rotatedAt: NOW }),
    );
    expect(result).toMatchObject({ ok: true, value: { hasBotToken: true } });
  });

  it('uses the security permission for the security channel', async () => {
    const harness = buildHarness({ allowedPermissions: ['alerts.security.manage'] });

    const result = await harness.useCase.create({ ...createInput, kind: 'telegram_security' });

    expect(result.ok).toBe(true);
    expect(harness.require).toHaveBeenCalledWith({ permission: 'alerts.security.manage' });
  });

  it('denies an Administrator (security only) the infrastructure channel without writing anything', async () => {
    const harness = buildHarness({ allowedPermissions: ['alerts.security.manage'] });

    await expect(harness.useCase.create(createInput)).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });

    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.putSecret).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  });

  it.each([
    ['name', { name: '   ' }],
    ['name', { name: 'x'.repeat(201) }],
    ['chatId', { chatId: '@canal_publico' }],
    ['chatId', { chatId: '12 34' }],
    ['botToken', { botToken: 'no-es-un-token' }],
    ['botToken', { botToken: '123456789:AA/../../ruta-0123456789abcdef' }],
  ])(
    'rejects an invalid %s before any write and never echoes the value',
    async (field, override) => {
      const harness = buildHarness();

      const result = await harness.useCase.create({ ...createInput, ...override });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION.FAILED' } });
      expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
      expect(JSON.stringify(result)).toContain(field);
      expect(harness.insert).not.toHaveBeenCalled();
    },
  );

  it('refuses a second active channel of the same kind', async () => {
    const harness = buildHarness({ activeOfKind: infraRecord() });

    const result = await harness.useCase.create(createInput);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTEGRATIONS.CHANNEL_ALREADY_ACTIVE' },
    });
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it('audits the creation with the kind only: never the token or the chat', async () => {
    const harness = buildHarness();

    await harness.useCase.create(createInput);

    const event = harness.record.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      action: 'integration.created',
      outcome: 'success',
      metadata: { kind: 'telegram_infra' },
    });
    expect(JSON.stringify(event)).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(event)).not.toContain(CHAT_ID);
  });
});

describe('ManageTelegramIntegrations.update', () => {
  it('audits only the names of the fields that changed', async () => {
    const harness = buildHarness();

    await harness.useCase.update(infraRecord().id, { name: 'Alertas', chatId: '-999' });

    expect(harness.update).toHaveBeenCalledWith(infraRecord().id, {
      name: 'Alertas',
      chatId: '-999',
    });
    expect(harness.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.updated',
      metadata: { kind: 'telegram_infra', changedFields: 'chatId' },
    });
  });

  it('does not write or audit when nothing changed', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.update(infraRecord().id, {
      name: 'Alertas',
      chatId: CHAT_ID,
    });

    expect(result.ok).toBe(true);
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an unknown integration and INTEGRATIONS.ARCHIVED for an archived one', async () => {
    const missing = buildHarness({ existing: null });
    const archived = buildHarness({ existing: infraRecord({ status: 'archived' }) });

    expect(await missing.useCase.update('x', { name: 'a', chatId: CHAT_ID })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await archived.useCase.update('x', { name: 'a', chatId: CHAT_ID })).toMatchObject({
      ok: false,
      error: { code: 'INTEGRATIONS.ARCHIVED' },
    });
  });

  it('requires the permission of the stored kind, not of the caller preference', async () => {
    const harness = buildHarness({ allowedPermissions: ['alerts.security.manage'] });

    await expect(
      harness.useCase.update(infraRecord().id, { name: 'Otro', chatId: CHAT_ID }),
    ).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(harness.update).not.toHaveBeenCalled();
  });
});

describe('ManageTelegramIntegrations.rotateBotToken', () => {
  it('increments the secret version so a stale re-encryption cannot resurrect the old token', async () => {
    const harness = buildHarness();

    await harness.useCase.rotateBotToken(infraRecord().id, NEW_BOT_TOKEN);

    expect(harness.encrypt.mock.calls[0]?.[0]).toMatchObject({ version: 5 });
    expect(harness.putSecret).toHaveBeenCalledWith(expect.objectContaining({ secretVersion: 5 }));
    expect(harness.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.secret_rotated',
      metadata: { kind: 'telegram_infra', field: 'bot_token', secretVersion: 5 },
    });
    expect(JSON.stringify(harness.record.mock.calls)).not.toContain(NEW_BOT_TOKEN);
  });

  it('starts at version 1 when no token was stored yet and rejects a malformed token', async () => {
    const first = buildHarness({ secret: null });
    await first.useCase.rotateBotToken(infraRecord().id, NEW_BOT_TOKEN);
    expect(first.putSecret).toHaveBeenCalledWith(expect.objectContaining({ secretVersion: 1 }));

    const invalid = buildHarness();
    expect(await invalid.useCase.rotateBotToken(infraRecord().id, 'basura')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION.FAILED' },
    });
    expect(invalid.putSecret).not.toHaveBeenCalled();
  });
});

describe('ManageTelegramIntegrations.archive', () => {
  it('archives with the clock time and audits the kind', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.archive(infraRecord().id);

    expect(harness.archive).toHaveBeenCalledWith(infraRecord().id, NOW);
    expect(result).toMatchObject({ ok: true, value: { status: 'archived' } });
    expect(harness.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.archived',
      metadata: { kind: 'telegram_infra' },
    });
  });
});

describe('ManageTelegramIntegrations.sendTest', () => {
  it('sends a fixed text with the decrypted token and audits success', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.sendTest(infraRecord().id);

    expect(result).toEqual({ ok: true, value: 'sent' });
    const sent = harness.send.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ botToken: BOT_TOKEN, chatId: CHAT_ID });
    expect(sent?.text).toContain('Compass');
    expect(harness.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.test_sent',
      outcome: 'success',
      metadata: { kind: 'telegram_infra', outcome: 'sent' },
    });
  });

  it('reports a failed send as a result and an audited failure, not as an error', async () => {
    const harness = buildHarness({
      sendResult: { ok: false, code: 'CHAT_REJECTED', retryable: false },
    });

    const result = await harness.useCase.sendTest(infraRecord().id);

    expect(result).toEqual({ ok: true, value: 'CHAT_REJECTED' });
    expect(harness.record.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failure',
      reasonCode: 'CHAT_REJECTED',
      metadata: { kind: 'telegram_infra', outcome: 'CHAT_REJECTED' },
    });
    expect(JSON.stringify(harness.record.mock.calls)).not.toContain(BOT_TOKEN);
  });

  it('answers NOT_CONFIGURED without a saved token and throws when the token cannot be opened', async () => {
    const noToken = buildHarness({ secret: null });
    expect(await noToken.useCase.sendTest(infraRecord().id)).toMatchObject({
      ok: false,
      error: { code: 'INTEGRATIONS.NOT_CONFIGURED' },
    });
    expect(noToken.send).not.toHaveBeenCalled();

    const broken = buildHarness({ decryptOk: false });
    await expect(broken.useCase.sendTest(infraRecord().id)).rejects.toMatchObject({
      code: 'CRYPTO.DECRYPT_FAILED',
    });
    expect(broken.send).not.toHaveBeenCalled();
  });
});

describe('ManageTelegramIntegrations.list', () => {
  it('lists the channels the person can manage', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.list();

    expect(result).toMatchObject({ ok: true });
  });

  it('denies a person with no channel permission instead of returning an empty list', async () => {
    const harness = buildHarness({ allowedPermissions: [] });

    await expect(harness.useCase.list()).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
  });
});
