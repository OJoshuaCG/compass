import { TOTP_CONFIRM_MAX_FAILURES } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { InMemoryTotpConfirmAttemptStore } from '../infrastructure/in-memory-totp-confirm-attempt-store.js';
import { OtplibTotpGenerator } from '../infrastructure/otplib-totp-generator.js';
import { ManageTotp } from './manage-totp.js';
import type { ManageTotpDeps } from './manage-totp.js';
import type { TotpRecord } from './ports/totp-repository.js';

const REGISTRANT_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const SUPERIOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000002');
const CREDENTIAL_ID = '0198bbbb-0000-7000-8000-000000000001';
const ACCOUNT_ID = '0198cccc-0000-7000-8000-000000000001';
const SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const OTPAUTH_URI = `otpauth://totp/Brand:ada@brand.example?secret=${SECRET_BASE32}&issuer=Brand`;
const NOW = new Date('2026-03-04T16:00:00.000Z');
const WRONG_CODE = '000000';
const MILLISECONDS_PER_MINUTE = 60 * 1000;
// Fijados con números literales a propósito: si cambia la constante de contratos esta prueba debe pedir revisión.
const FIRST_LOCK_MS = 5 * MILLISECONDS_PER_MINUTE;

const generator = new OtplibTotpGenerator();
const PARAMETERS = { algorithm: 'SHA1', digits: 6, periodSeconds: 30 } as const;

type ShareLevelName = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE';

function totpRecord(status: TotpRecord['status']): TotpRecord {
  return {
    credentialId: CREDENTIAL_ID,
    secretVersion: 1,
    status,
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    registeredBy: REGISTRANT_ID,
    registeredAt: NOW,
    verifiedAt: null,
    retiredAt: null,
    exposedAt: null,
  };
}

interface HarnessOptions {
  readonly status?: TotpRecord['status'];
  readonly level?: ShareLevelName | null;
  readonly requireRejection?: DomainError;
}

function buildHarness(options: HarnessOptions = {}) {
  let currentTime = NOW;
  let actorId: UserId = REGISTRANT_ID;
  let current = totpRecord(options.status ?? 'pending');
  const markVerified = vi.fn(() => {
    current = { ...current, status: 'verified', verifiedAt: currentTime };
    return Promise.resolve();
  });
  const level = options.level === undefined ? 'MANAGE' : options.level;
  const require = vi.fn(() =>
    options.requireRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.requireRejection),
  );
  const auditRecord = vi.fn((event: { action: string; outcome: string }) => Promise.resolve(event));
  const auditDenial = vi.fn(() => Promise.resolve());
  const confirmAttempts = new InMemoryTotpConfirmAttemptStore();

  const deps = {
    context: {
      current: () => ({
        organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
        actorId,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: null,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require, auditDenial } as unknown as Authorizer,
    accounts: {
      findById: () => Promise.resolve({ id: ACCOUNT_ID, status: 'active' }),
      effectiveLevel: () => Promise.resolve(level),
    },
    credentials: {
      findById: () =>
        Promise.resolve({ id: CREDENTIAL_ID, accountId: ACCOUNT_ID, archivedAt: null }),
      findByIdForUpdate: () =>
        Promise.resolve({ id: CREDENTIAL_ID, accountId: ACCOUNT_ID, archivedAt: null }),
      currentSecret: () =>
        Promise.resolve({
          version: 1,
          ciphertext: new Uint8Array(),
          nonce: new Uint8Array(),
          dekVersion: 1,
        }),
    },
    totps: { find: () => Promise.resolve(current), markVerified },
    cipher: {
      decrypt: () => Promise.resolve(ok(new TextEncoder().encode(OTPAUTH_URI))),
    } as unknown as SecretCipher,
    generator,
    audit: { record: auditRecord },
    auditCounter: { count: () => Promise.resolve(0) },
    ids: { next: () => 'id' },
    clock: { now: () => currentTime },
    confirmAttempts,
  } as unknown as ManageTotpDeps;

  return {
    useCase: new ManageTotp(deps),
    require,
    auditRecord,
    auditDenial,
    actAs: (userId: UserId) => {
      actorId = userId;
    },
    advanceClock: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    correctCodeNow: () => generator.codeAt(SECRET_BASE32, PARAMETERS, currentTime),
  };
}

async function lockRegistration(useCase: ManageTotp, harness: { actAs: (id: UserId) => void }) {
  harness.actAs(REGISTRANT_ID);
  for (let attempt = 0; attempt < TOTP_CONFIRM_MAX_FAILURES; attempt += 1) {
    await useCase.confirm(CREDENTIAL_ID, WRONG_CODE);
  }
}

const failureCodeOf = async (promise: Promise<{ ok: boolean; error?: DomainError }>) => {
  const result = await promise;
  if (result.ok || result.error === undefined) throw new Error('The call was expected to fail');
  return result.error.code;
};

// SENSIBLE (revisión humana)
describe('ManageTotp.unlockConfirmation', () => {
  it('asks the engine for the existing second factor administration permission', async () => {
    const harness = buildHarness();
    await lockRegistration(harness.useCase, harness);
    harness.actAs(SUPERIOR_ID);

    await harness.useCase.unlockConfirmation(CREDENTIAL_ID);

    expect(harness.require).toHaveBeenLastCalledWith({ permission: 'credential.export_totp' });
  });

  it('does nothing when the engine denies the permission (no unlock, no unlock audit)', async () => {
    const denial = new DomainError('AUTHZ.PERMISSION', 'Action not allowed');
    const harness = buildHarness({ requireRejection: denial });
    harness.actAs(SUPERIOR_ID);

    await expect(harness.useCase.unlockConfirmation(CREDENTIAL_ID)).rejects.toBe(denial);

    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it.each<ShareLevelName>(['USE', 'VIEW', 'EDIT'])(
    'denies level %s with AUTHZ.SHARE, audits the denial and leaves the lock in place',
    async (level) => {
      const harness = buildHarness({ level });
      await lockRegistration(harness.useCase, harness);
      harness.actAs(SUPERIOR_ID);

      const code = await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID));

      expect(code).toBe('AUTHZ.SHARE');
      expect(harness.auditDenial).toHaveBeenCalledWith({
        code: 'AUTHZ.SHARE',
        permission: 'credential.export_totp',
        targetAccountId: ACCOUNT_ID,
      });
      expect(
        harness.auditRecord.mock.calls.some(([e]) => e.action === 'credential.totp_unlocked'),
      ).toBe(false);
    },
  );

  it('answers NOT_FOUND without any access to the account', async () => {
    const harness = buildHarness({ level: null });
    harness.actAs(SUPERIOR_ID);

    expect(await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID))).toBe(
      'NOT_FOUND',
    );
  });

  it('denies the person who registered the pending factor, audits the denial and keeps the lock', async () => {
    const harness = buildHarness();
    await lockRegistration(harness.useCase, harness);
    harness.actAs(REGISTRANT_ID);
    const auditsBefore = harness.auditRecord.mock.calls.length;

    const code = await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID));

    expect(code).toBe('CREDENTIAL.TOTP_UNLOCK_SELF');
    expect(harness.auditDenial).toHaveBeenCalledWith({
      code: 'CREDENTIAL.TOTP_UNLOCK_SELF',
      permission: 'credential.export_totp',
      targetAccountId: ACCOUNT_ID,
    });
    expect(harness.auditRecord.mock.calls.length).toBe(auditsBefore);
    expect(
      await failureCodeOf(harness.useCase.confirm(CREDENTIAL_ID, harness.correctCodeNow())),
    ).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');
  });

  it('answers TOTP_NOT_LOCKED when the pending registration is not locked', async () => {
    const harness = buildHarness();
    harness.actAs(SUPERIOR_ID);

    expect(await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID))).toBe(
      'CREDENTIAL.TOTP_NOT_LOCKED',
    );
  });

  it('answers TOTP_NOT_LOCKED once the lock has already expired', async () => {
    const harness = buildHarness();
    await lockRegistration(harness.useCase, harness);
    harness.actAs(SUPERIOR_ID);
    harness.advanceClock(FIRST_LOCK_MS);

    expect(await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID))).toBe(
      'CREDENTIAL.TOTP_NOT_LOCKED',
    );
  });

  it.each(['verified', 'retired'] as const)(
    'answers TOTP_NOT_LOCKED for a %s factor',
    async (status) => {
      const harness = buildHarness({ status });
      harness.actAs(SUPERIOR_ID);

      expect(await failureCodeOf(harness.useCase.unlockConfirmation(CREDENTIAL_ID))).toBe(
        'CREDENTIAL.TOTP_NOT_LOCKED',
      );
    },
  );

  it('lets the registration be confirmed right after the unlock and audits it without secrets', async () => {
    const harness = buildHarness();
    await lockRegistration(harness.useCase, harness);
    harness.actAs(SUPERIOR_ID);

    const unlocked = await harness.useCase.unlockConfirmation(CREDENTIAL_ID);

    expect(unlocked.ok).toBe(true);
    const unlockAudits = harness.auditRecord.mock.calls
      .map(([event]) => event as unknown as Record<string, unknown>)
      .filter((event) => event.action === 'credential.totp_unlocked');
    expect(unlockAudits).toHaveLength(1);
    expect(unlockAudits[0]).toMatchObject({
      actorId: SUPERIOR_ID,
      targetType: 'credential',
      targetId: CREDENTIAL_ID,
      outcome: 'success',
      metadata: { lockLevel: 1, registeredBy: REGISTRANT_ID },
    });
    expect(JSON.stringify(unlockAudits)).not.toContain(SECRET_BASE32);

    harness.actAs(REGISTRANT_ID);
    const confirmed = await harness.useCase.confirm(CREDENTIAL_ID, harness.correctCodeNow());
    expect(confirmed.ok).toBe(true);
  });

  it('clears the failures but keeps the escalation level: the next lock lasts 15 minutes', async () => {
    const harness = buildHarness();
    await lockRegistration(harness.useCase, harness);
    harness.actAs(SUPERIOR_ID);
    await harness.useCase.unlockConfirmation(CREDENTIAL_ID);

    // Diez fallos más para el siguiente bloqueo: la cuenta de fallos arrancó en cero.
    await lockRegistration(harness.useCase, harness);
    harness.advanceClock(FIRST_LOCK_MS);

    // A los 5 min sigue bloqueado: el escalón es el segundo (15 min), no el primero.
    expect(await failureCodeOf(harness.useCase.confirm(CREDENTIAL_ID, WRONG_CODE))).toBe(
      'CREDENTIAL.TOTP_CONFIRM_LOCKED',
    );
  });

  it('exposes the end of the lock in the status only while it lasts', async () => {
    const harness = buildHarness();
    harness.actAs(SUPERIOR_ID);
    const beforeLock = await harness.useCase.status(CREDENTIAL_ID);
    await lockRegistration(harness.useCase, harness);
    harness.actAs(SUPERIOR_ID);
    const duringLock = await harness.useCase.status(CREDENTIAL_ID);
    harness.advanceClock(FIRST_LOCK_MS);
    const afterLock = await harness.useCase.status(CREDENTIAL_ID);

    expect(beforeLock.ok && beforeLock.value.confirmLockedUntil).toBeNull();
    expect(duringLock.ok && duringLock.value.confirmLockedUntil).toEqual(
      new Date(NOW.getTime() + FIRST_LOCK_MS),
    );
    expect(afterLock.ok && afterLock.value.confirmLockedUntil).toBeNull();
  });
});
