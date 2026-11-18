import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId } from '../../../shared/kernel/index.js';
import { ResolveOrganizationSmtp } from './resolve-organization-smtp.js';
import type { ResolveOrganizationSmtpDeps } from './resolve-organization-smtp.js';
import type { SmtpSettingsRecord } from './ports/smtp-settings-store.js';

const NOW = new Date('2026-11-17T10:00:00.000Z');
const ACTIVE: SmtpSettingsRecord = {
  id: 'id-1',
  name: 'Correo',
  status: 'active',
  host: 'smtp.example.com',
  port: 465,
  security: 'tls',
  username: 'mailer@example.com',
  fromAddress: 'no-reply@example.com',
  hasPassword: true,
  createdAt: NOW,
  updatedAt: NOW,
};
const STORED = {
  secretVersion: 3,
  encrypted: { ciphertext: new Uint8Array([1]), nonce: new Uint8Array(12), dekVersion: 1 },
};

function build(options: {
  active?: SmtpSettingsRecord | null;
  stored?: typeof STORED | null;
  decryptFails?: boolean;
}) {
  const decrypt = vi.fn(() =>
    Promise.resolve(
      options.decryptFails === true
        ? { ok: false as const, error: new DomainError('CRYPTO.DECRYPT_FAILED', 'cannot open') }
        : { ok: true as const, value: new TextEncoder().encode('the-password') },
    ),
  );
  const deps = {
    context: { current: () => ({ organizationId: 'org-1' as OrganizationId }) },
    uow: { run: <T>(fn: () => Promise<T>) => fn() },
    settings: {
      findActive: () => Promise.resolve(options.active === undefined ? ACTIVE : options.active),
      findPassword: () => Promise.resolve(options.stored === undefined ? STORED : options.stored),
    },
    cipher: { decrypt },
  } as unknown as ResolveOrganizationSmtpDeps;
  return { resolver: new ResolveOrganizationSmtp(deps), decrypt };
}

describe('ResolveOrganizationSmtp', () => {
  it('returns the connection and the opened password', async () => {
    const { resolver } = build({});
    await expect(resolver.resolve()).resolves.toEqual({
      connection: {
        host: 'smtp.example.com',
        port: 465,
        security: 'tls',
        username: 'mailer@example.com',
        fromAddress: 'no-reply@example.com',
      },
      password: 'the-password',
    });
  });

  it('returns null without an active server, so the environment server is used', async () => {
    const { resolver, decrypt } = build({ active: null });
    await expect(resolver.resolve()).resolves.toBeNull();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns null when the active server has no saved password', async () => {
    const { resolver } = build({ stored: null });
    await expect(resolver.resolve()).resolves.toBeNull();
  });

  it('throws when the password cannot be opened instead of falling back', async () => {
    const { resolver } = build({ decryptFails: true });
    await expect(resolver.resolve()).rejects.toThrow(DomainError);
  });
});
