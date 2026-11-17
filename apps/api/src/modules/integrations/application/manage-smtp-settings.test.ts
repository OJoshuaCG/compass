import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { EncryptedSecret } from '../../crypto/index.js';
import { ManageSmtpSettings } from './manage-smtp-settings.js';
import type { ManageSmtpSettingsDeps, SmtpSettingsInput } from './manage-smtp-settings.js';
import type {
  SmtpSettingsRecord,
  SmtpSettingsStore,
  SmtpTestSendResult,
} from './ports/smtp-settings-store.js';

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTOR_ID = 'user-1' as UserId;
const PASSWORD = 'correct horse battery staple';
const NOW = new Date('2026-11-17T10:00:00.000Z');
const ENCRYPTED: EncryptedSecret = {
  ciphertext: new Uint8Array([1, 2, 3]),
  nonce: new Uint8Array(12),
  dekVersion: 2,
};

const VALID_INPUT: SmtpSettingsInput = {
  name: 'Correo corporativo',
  host: 'smtp.example.com',
  port: 587,
  security: 'starttls',
  username: 'mailer@example.com',
  fromAddress: 'no-reply@example.com',
};

function record(overrides: Partial<SmtpSettingsRecord> = {}): SmtpSettingsRecord {
  return {
    id: '0190aaaa-0000-7000-8000-000000000002',
    name: VALID_INPUT.name,
    status: 'active',
    host: VALID_INPUT.host,
    port: VALID_INPUT.port,
    security: VALID_INPUT.security,
    username: VALID_INPUT.username,
    fromAddress: VALID_INPUT.fromAddress,
    hasPassword: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface Options {
  readonly existing?: SmtpSettingsRecord | null;
  readonly active?: SmtpSettingsRecord | null;
  readonly hasPassword?: boolean;
  readonly allowed?: boolean;
  readonly sendResult?: SmtpTestSendResult;
}

function buildHarness(options: Options = {}) {
  const existing = options.existing === undefined ? record() : options.existing;
  const insert = vi.fn(() => Promise.resolve(record({ id: 'new-id', hasPassword: false })));
  const update = vi.fn((id: string) => Promise.resolve(record({ id })));
  const archive = vi.fn((id: string) => Promise.resolve(record({ id, status: 'archived' })));
  const putPassword = vi.fn<(secret: Record<string, unknown>) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const settings: SmtpSettingsStore = {
    findForUpdate: vi.fn(() => Promise.resolve(existing)),
    findActive: vi.fn(() => Promise.resolve(options.active ?? null)),
    list: vi.fn(() => Promise.resolve([record()])),
    insert,
    update,
    archive,
    findPassword: vi.fn(() =>
      Promise.resolve(
        options.hasPassword === false ? null : { secretVersion: 4, encrypted: ENCRYPTED },
      ),
    ),
    putPassword,
  };
  const require = vi.fn(() =>
    options.allowed === false
      ? Promise.reject(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'))
      : Promise.resolve([]),
  );
  const audit = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
  const encrypt = vi.fn<
    (context: Record<string, unknown>, plaintext: Uint8Array) => Promise<unknown>
  >(() => Promise.resolve({ ok: true as const, value: ENCRYPTED }));
  const decrypt = vi.fn(() =>
    Promise.resolve({ ok: true as const, value: new TextEncoder().encode(PASSWORD) }),
  );
  const send = vi.fn<(input: Record<string, unknown>) => Promise<SmtpTestSendResult>>(() =>
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
    authorizer: { require, actorPermissions: () => Promise.resolve(new Set()) },
    settings,
    cipher: { encrypt, decrypt },
    sender: { send },
    audit: { record: audit },
    clock: { now: () => NOW },
  } as unknown as ManageSmtpSettingsDeps;
  return {
    useCase: new ManageSmtpSettings(deps),
    insert,
    update,
    archive,
    putPassword,
    require,
    audit,
    encrypt,
    send,
  };
}

describe('create', () => {
  it('stores the settings and the encrypted password and audits without secrets', async () => {
    const h = buildHarness();
    const result = await h.useCase.create({ ...VALID_INPUT, password: PASSWORD });

    expect(result.ok).toBe(true);
    expect(h.putPassword).toHaveBeenCalledTimes(1);
    expect(h.putPassword.mock.calls[0]?.[0]).toMatchObject({ secretVersion: 1 });
    expect(h.audit).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(h.audit.mock.calls);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain('smtp.example.com');
    expect(h.audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.created',
      metadata: { kind: 'smtp_mail' },
    });
  });

  it('requires the infrastructure permission before anything else', async () => {
    const h = buildHarness({ allowed: false });
    await expect(h.useCase.create({ ...VALID_INPUT, password: PASSWORD })).rejects.toThrow(
      DomainError,
    );
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.require).toHaveBeenCalledWith({ permission: 'alerts.infra.manage' });
  });

  it.each([
    ['host', { host: 'localhost' }],
    ['host', { host: '10.0.0.5' }],
    ['port', { port: 70_000 }],
    ['security', { security: 'none' as never }],
    ['fromAddress', { fromAddress: 'Compass <a@example.com>' }],
    ['username', { username: 'a\r\nb' }],
  ])('rejects an invalid %s without writing', async (field, override) => {
    const h = buildHarness();
    const result = await h.useCase.create({ ...VALID_INPUT, ...override, password: PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.meta).toEqual({ field });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.putPassword).not.toHaveBeenCalled();
  });

  it('rejects a password with line breaks', async () => {
    const h = buildHarness();
    const result = await h.useCase.create({ ...VALID_INPUT, password: 'a\nb' });
    expect(result.ok).toBe(false);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it('refuses a second active server', async () => {
    const h = buildHarness({ active: record() });
    const result = await h.useCase.create({ ...VALID_INPUT, password: PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTEGRATIONS.CHANNEL_ALREADY_ACTIVE');
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  it('lists only the changed field names in the audit', async () => {
    const h = buildHarness();
    await h.useCase.update('id', { ...VALID_INPUT, port: 465, security: 'tls' });
    expect(h.audit.mock.calls[0]?.[0]).toMatchObject({
      metadata: { kind: 'smtp_mail', changedFields: 'port,security' },
    });
  });

  it('does not write or audit when nothing changed', async () => {
    const h = buildHarness();
    const result = await h.useCase.update('id', VALID_INPUT);
    expect(result.ok).toBe(true);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('refuses to change an archived server', async () => {
    const h = buildHarness({ existing: record({ status: 'archived' }) });
    const result = await h.useCase.update('id', { ...VALID_INPUT, port: 465 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INTEGRATIONS.ARCHIVED');
  });

  it('answers NOT_FOUND for a server of another organization or kind', async () => {
    const h = buildHarness({ existing: null });
    const result = await h.useCase.update('id', VALID_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('rotatePassword', () => {
  it('bumps the secret version and audits the field name only', async () => {
    const h = buildHarness();
    await h.useCase.rotatePassword('id', 'another long password');
    expect(h.putPassword.mock.calls[0]?.[0]).toMatchObject({ secretVersion: 5 });
    expect(h.audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'integration.secret_rotated',
      metadata: { kind: 'smtp_mail', field: 'smtp_password', secretVersion: 5 },
    });
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('another long password');
  });

  it('throws when encryption fails so the transaction rolls back', async () => {
    const h = buildHarness();
    h.encrypt.mockResolvedValueOnce({
      ok: false,
      error: new DomainError('CRYPTO.DECRYPT_FAILED', 'no key'),
    });
    await expect(h.useCase.rotatePassword('id', 'another long password')).rejects.toThrow(
      DomainError,
    );
    expect(h.audit).not.toHaveBeenCalled();
  });
});

describe('sendTest', () => {
  it('sends to the sender address itself and reports sent', async () => {
    const h = buildHarness();
    const result = await h.useCase.sendTest('id');
    expect(result).toEqual({ ok: true, value: 'sent' });
    expect(h.send.mock.calls[0]?.[0]).toMatchObject({
      recipient: 'no-reply@example.com',
      password: PASSWORD,
    });
  });

  it('reports a stable code and audits it as a failure, never server text', async () => {
    const h = buildHarness({ sendResult: { ok: false, code: 'AUTH_REJECTED' } });
    const result = await h.useCase.sendTest('id');
    expect(result).toEqual({ ok: true, value: 'AUTH_REJECTED' });
    expect(h.audit.mock.calls[0]?.[0]).toMatchObject({
      outcome: 'failure',
      reasonCode: 'AUTH_REJECTED',
    });
  });

  it('answers NOT_CONFIGURED when there is no saved password', async () => {
    const h = buildHarness({ hasPassword: false });
    const result = await h.useCase.sendTest('id');
    expect(result.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('archive', () => {
  it('archives and audits', async () => {
    const h = buildHarness();
    await h.useCase.archive('id');
    expect(h.archive).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0]?.[0]).toMatchObject({ action: 'integration.archived' });
  });
});
