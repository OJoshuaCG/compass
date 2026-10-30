import type { Permission, ShareLevel } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { RANK, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import { Authorizer, DenialGrouper } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { ManageCredentials } from './manage-credentials.js';
import type { ManageCredentialsDeps } from './manage-credentials.js';

const ORGANIZATION_ID = asOrganizationId('0198dddd-0000-7000-8000-000000000001');
const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const CREDENTIAL_ID = '0198bbbb-0000-7000-8000-000000000001';
const ACCOUNT_ID = '0198cccc-0000-7000-8000-000000000001';
const NOW = new Date('2026-03-04T16:00:00.000Z');
const OLD_VERSION = 1;
const CURRENT_VERSION = 2;
const OLD_PASSWORD_CANARY = 'Canary-Old-Password-5521';

type RecordedAuditEvent = Parameters<AuditLog['record']>[0];

interface BuildOptions {
  /** Permisos del único rol de la persona que actúa. */
  readonly permissions: readonly Permission[];
  /** Nivel efectivo de la persona sobre la cuenta. */
  readonly level: ShareLevel | null;
}

/**
 * Usa el motor de autorización REAL (con directorio y roles en memoria): lo que se prueba es que el
 * caso de uso pide el permiso nuevo al motor y que el motor niega y audita, no un doble que siempre
 * responde lo que la prueba quiere.
 */
function buildUseCase(options: BuildOptions) {
  const auditEvents: RecordedAuditEvent[] = [];
  const audit = {
    record: (event: RecordedAuditEvent) => {
      auditEvents.push(event);
      return Promise.resolve(ok({} as never));
    },
  } as unknown as AuditLog;

  const context = {
    current: () => ({
      organizationId: ORGANIZATION_ID,
      actorId: ACTOR_ID,
      requestId: 'req-1',
      sessionId: null,
      reauthAt: null,
    }),
  };
  const clock = { now: () => NOW };

  const authorizer = new Authorizer({
    context,
    directory: {
      findById: () =>
        Promise.resolve({
          id: ACTOR_ID,
          organizationId: ORGANIZATION_ID,
          rank: RANK.LEADER,
          status: 'active',
        }),
    },
    roles: { rolePermissionsOf: () => Promise.resolve([options.permissions]) },
    audit,
    clock,
    denialGrouper: new DenialGrouper(clock),
    independently: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as ConstructorParameters<typeof Authorizer>[0]);

  const secret = (version: number, isCurrent: boolean) => ({
    field: 'password' as const,
    version,
    ciphertext: new Uint8Array([version]),
    nonce: new Uint8Array([version]),
    dekVersion: 1,
    isCurrent,
    createdBy: ACTOR_ID,
    createdAt: NOW,
  });

  const retireCurrentSecret = vi.fn(() => Promise.resolve());
  const insertSecret = vi.fn(() => Promise.resolve());
  const upsertPasswordFingerprint = vi.fn(() => Promise.resolve());
  const markRotated = vi.fn(() => Promise.resolve());
  const credentialRecord = {
    id: CREDENTIAL_ID,
    accountId: ACCOUNT_ID,
    archivedAt: null,
  };
  const decrypt = vi.fn(() => Promise.resolve(ok(new TextEncoder().encode(OLD_PASSWORD_CANARY))));

  const deps = {
    context,
    uow: { run: <T>(fn: () => Promise<T>) => fn() },
    authorizer,
    accounts: {
      findById: () => Promise.resolve({ id: ACCOUNT_ID, status: 'active' }),
      effectiveLevel: () => Promise.resolve(options.level),
    },
    credentials: {
      findByIdForUpdate: () => Promise.resolve(credentialRecord),
      findById: () => Promise.resolve(credentialRecord),
      secretByVersion: (_credentialId: string, _field: string, version: number) =>
        Promise.resolve(
          version === OLD_VERSION
            ? secret(OLD_VERSION, false)
            : version === CURRENT_VERSION
              ? secret(CURRENT_VERSION, true)
              : null,
        ),
      currentSecret: () => Promise.resolve(secret(CURRENT_VERSION, true)),
      retireCurrentSecret,
      insertSecret,
      upsertPasswordFingerprint,
      markRotated,
    },
    cipher: {
      decrypt,
      encrypt: () =>
        Promise.resolve(
          ok({ ciphertext: new Uint8Array([9]), nonce: new Uint8Array([9]), dekVersion: 1 }),
        ),
      blindIndex: () => Promise.resolve(ok({ index: 'ab12' })),
    } as unknown as SecretCipher,
    audit,
    auditCounter: { count: () => Promise.resolve(0) },
    ids: { next: () => 'id-1' },
    clock,
  } as unknown as ManageCredentialsDeps;

  return {
    useCase: new ManageCredentials(deps),
    auditEvents,
    decrypt,
    retireCurrentSecret,
    insertSecret,
    markRotated,
  };
}

const denialsOf = (events: readonly RecordedAuditEvent[]) =>
  events.filter((event) => event.action === 'authz.denied');

// SENSIBLE (revisión humana): permiso propio para restaurar una versión de la contraseña.
describe('ManageCredentials.restoreVersion permission', () => {
  it('restores with credential.restore_version and EDIT, creating the next version and auditing it', async () => {
    const { useCase, auditEvents, insertSecret, retireCurrentSecret, markRotated } = buildUseCase({
      permissions: ['credential.restore_version'],
      level: 'EDIT',
    });

    const result = await useCase.restoreVersion(CREDENTIAL_ID, OLD_VERSION);

    expect(result.ok).toBe(true);
    expect(retireCurrentSecret).toHaveBeenCalledTimes(1);
    expect(insertSecret).toHaveBeenCalledTimes(1);
    expect(insertSecret).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: CREDENTIAL_ID, field: 'password', version: 3 }),
    );
    expect(markRotated).toHaveBeenCalledTimes(1);
    const restored = auditEvents.filter((event) => event.action === 'credential.version_restored');
    expect(restored).toHaveLength(1);
    expect(restored[0]?.metadata).toEqual({ restoredVersion: OLD_VERSION, newVersion: 3 });
    expect(denialsOf(auditEvents)).toHaveLength(0);
    expect(JSON.stringify(auditEvents)).not.toContain(OLD_PASSWORD_CANARY);
  });

  it('denies a person with credential.update but without credential.restore_version, and audits the denial', async () => {
    const { useCase, auditEvents, decrypt, retireCurrentSecret, insertSecret, markRotated } =
      buildUseCase({ permissions: ['credential.update'], level: 'EDIT' });

    await expect(useCase.restoreVersion(CREDENTIAL_ID, OLD_VERSION)).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });

    const denials = denialsOf(auditEvents);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      outcome: 'denied',
      reasonCode: 'AUTHZ.PERMISSION',
      actorId: ACTOR_ID,
      metadata: { permission: 'credential.restore_version' },
    });
    // Negado antes de tocar nada: no se descifra, no se retira la vigente, no se escribe versión.
    expect(decrypt).not.toHaveBeenCalled();
    expect(retireCurrentSecret).not.toHaveBeenCalled();
    expect(insertSecret).not.toHaveBeenCalled();
    expect(markRotated).not.toHaveBeenCalled();
    expect(auditEvents.some((event) => event.action === 'credential.version_restored')).toBe(false);
  });

  it('denies a person with no permissions at all, and audits the denial', async () => {
    const { useCase, auditEvents, insertSecret } = buildUseCase({ permissions: [], level: 'EDIT' });

    await expect(useCase.restoreVersion(CREDENTIAL_ID, OLD_VERSION)).rejects.toMatchObject({
      code: 'AUTHZ.PERMISSION',
    });

    expect(denialsOf(auditEvents)).toHaveLength(1);
    expect(insertSecret).not.toHaveBeenCalled();
  });

  it('still requires the EDIT level: with the permission but VIEW it denies and audits with the new permission', async () => {
    const { useCase, auditEvents, insertSecret } = buildUseCase({
      permissions: ['credential.restore_version'],
      level: 'VIEW',
    });

    const result = await useCase.restoreVersion(CREDENTIAL_ID, OLD_VERSION);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
    const denials = denialsOf(auditEvents);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      reasonCode: 'AUTHZ.SHARE',
      metadata: { permission: 'credential.restore_version' },
    });
    expect(insertSecret).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND and audits when the person has the permission but no access to the account', async () => {
    const { useCase, auditEvents, insertSecret } = buildUseCase({
      permissions: ['credential.restore_version'],
      level: null,
    });

    const result = await useCase.restoreVersion(CREDENTIAL_ID, OLD_VERSION);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(denialsOf(auditEvents)).toHaveLength(1);
    expect(insertSecret).not.toHaveBeenCalled();
  });
});
