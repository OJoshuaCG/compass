import { TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL, TOTP_CONFIRM_MAX_FAILURES } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { DomainError } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { InMemoryTotpConfirmAttemptStore } from '../infrastructure/in-memory-totp-confirm-attempt-store.js';
import { OtplibTotpGenerator } from '../infrastructure/otplib-totp-generator.js';
import { ManageTotp } from './manage-totp.js';
import type { ManageTotpDeps } from './manage-totp.js';
import type { TotpRecord } from './ports/totp-repository.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const CREDENTIAL_ID = '0198bbbb-0000-7000-8000-000000000001';
const ACCOUNT_ID = '0198cccc-0000-7000-8000-000000000001';
const SECRET_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const OTPAUTH_URI = `otpauth://totp/Brand:ada@brand.example?secret=${SECRET_BASE32}&issuer=Brand`;
const NOW = new Date('2026-03-04T16:00:00.000Z');
const WRONG_CODE = '000000';
const MILLISECONDS_PER_MINUTE = 60 * 1000;
// Duraciones del encargo (T5b): 1ª vez 5 min, 2ª 15 min, 3ª y siguientes 60 min. Se fijan aquí con números
// literales a propósito: si alguien cambia la constante de contratos, esta prueba debe fallar y pedir revisión.
const FIRST_LOCK_MS = 5 * MILLISECONDS_PER_MINUTE;
const SECOND_LOCK_MS = 15 * MILLISECONDS_PER_MINUTE;
const THIRD_AND_LATER_LOCK_MS = 60 * MILLISECONDS_PER_MINUTE;

const generator = new OtplibTotpGenerator();
const PARAMETERS = { algorithm: 'SHA1', digits: 6, periodSeconds: 30 } as const;
const correctCode = generator.codeAt(SECRET_BASE32, PARAMETERS, NOW);
// "Casi correcto": el código válido con el último dígito alterado.
const almostCorrectCode = `${correctCode.slice(0, -1)}${correctCode.endsWith('0') ? '1' : '0'}`;

function pendingTotp(secretVersion: number): TotpRecord {
  return {
    credentialId: CREDENTIAL_ID,
    secretVersion,
    status: 'pending',
    algorithm: 'SHA1',
    digits: 6,
    periodSeconds: 30,
    registeredBy: ACTOR_ID,
    registeredAt: NOW,
    verifiedAt: null,
    retiredAt: null,
    exposedAt: null,
  };
}

function buildUseCase(initialSecretVersion = 1) {
  let currentTime = NOW;
  let current = pendingTotp(initialSecretVersion);
  const markVerified = vi.fn(() => {
    current = { ...current, status: 'verified', verifiedAt: NOW };
    return Promise.resolve();
  });
  const auditRecord = vi.fn((event: { action: string; outcome: string }) => Promise.resolve(event));
  const auditDenial = vi.fn(() => Promise.resolve());
  const confirmAttempts = new InMemoryTotpConfirmAttemptStore();

  const deps = {
    context: {
      current: () => ({
        organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
        actorId: ACTOR_ID,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: null,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require: () => Promise.resolve(), auditDenial } as unknown as Authorizer,
    accounts: {
      findById: () => Promise.resolve({ id: ACCOUNT_ID, status: 'active' }),
      effectiveLevel: () => Promise.resolve('EDIT'),
    },
    credentials: {
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
    totps: {
      find: () => Promise.resolve(current),
      markVerified,
    },
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
    markVerified,
    auditRecord,
    auditDenial,
    startNewRegistration: (secretVersion: number) => {
      current = pendingTotp(secretVersion);
    },
    advanceClock: (milliseconds: number) => {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    // El código correcto depende del reloj: tras avanzarlo hay que recalcularlo.
    correctCodeNow: () => generator.codeAt(SECRET_BASE32, PARAMETERS, currentTime),
  };
}

async function failTimes(
  useCase: ManageTotp,
  times: number,
  code = WRONG_CODE,
): Promise<readonly DomainError[]> {
  const errors: DomainError[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    const result = await useCase.confirm(CREDENTIAL_ID, code);
    if (result.ok) throw new Error('A wrong code must not confirm');
    errors.push(result.error);
  }
  return errors;
}

// SENSIBLE (revisión humana)
describe('ManageTotp.confirm attempt limit', () => {
  it('rejects wrong codes with the same error and audits each failure until the limit', async () => {
    const { useCase, auditRecord, auditDenial } = buildUseCase();

    const errors = await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);

    expect(errors.every((error) => error.code === 'CREDENTIAL.TOTP_CODE_INVALID')).toBe(true);
    const failureAudits = auditRecord.mock.calls.filter(
      ([event]) => event.action === 'credential.totp_confirmed' && event.outcome === 'failure',
    );
    expect(failureAudits).toHaveLength(TOTP_CONFIRM_MAX_FAILURES);
    expect(auditDenial).not.toHaveBeenCalled();
  });

  it('locks the pending registration after the maximum failures, even for the correct code', async () => {
    const { useCase, markVerified, auditDenial } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);

    const lockedWithWrongCode = await useCase.confirm(CREDENTIAL_ID, WRONG_CODE);
    const lockedWithCorrectCode = await useCase.confirm(CREDENTIAL_ID, correctCode);

    for (const result of [lockedWithWrongCode, lockedWithCorrectCode]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');
    }
    expect(markVerified).not.toHaveBeenCalled();
    expect(auditDenial).toHaveBeenCalledTimes(2);
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'CREDENTIAL.TOTP_CONFIRM_LOCKED',
      permission: 'credential.update',
      targetAccountId: ACCOUNT_ID,
    });
  });

  it('does not count a locked attempt as another failure (no failure audit once locked)', async () => {
    const { useCase, auditRecord } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    const auditsBeforeLock = auditRecord.mock.calls.length;

    await useCase.confirm(CREDENTIAL_ID, WRONG_CODE);

    expect(auditRecord.mock.calls.length).toBe(auditsBeforeLock);
  });

  it('still confirms with the correct code on the last allowed attempt', async () => {
    const { useCase, markVerified } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES - 1);

    const result = await useCase.confirm(CREDENTIAL_ID, correctCode);

    expect(result.ok).toBe(true);
    expect(markVerified).toHaveBeenCalledTimes(1);
  });

  it('answers an almost-correct code exactly like any other wrong code', async () => {
    const { useCase } = buildUseCase();

    const [almostCorrect] = await failTimes(useCase, 1, almostCorrectCode);
    const [plainlyWrong] = await failTimes(useCase, 1, WRONG_CODE);

    expect(almostCorrect?.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
    expect(plainlyWrong?.code).toBe(almostCorrect?.code);
    expect(plainlyWrong?.message).toBe(almostCorrect?.message);
    expect(plainlyWrong?.meta).toEqual(almostCorrect?.meta);
  });

  it('starts a fresh count when the second factor is registered again', async () => {
    const { useCase, markVerified, startNewRegistration } = buildUseCase(1);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);

    startNewRegistration(2);
    const result = await useCase.confirm(CREDENTIAL_ID, correctCode);

    expect(result.ok).toBe(true);
    expect(markVerified).toHaveBeenCalledTimes(1);
  });

  it('keeps counting failures across several confirmations of the same registration', async () => {
    const { useCase } = buildUseCase();
    await failTimes(useCase, Math.floor(TOTP_CONFIRM_MAX_FAILURES / 2));
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES - Math.floor(TOTP_CONFIRM_MAX_FAILURES / 2));

    const result = await useCase.confirm(CREDENTIAL_ID, correctCode);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');
  });
});

// SENSIBLE (revisión humana)
describe('ManageTotp.confirm escalating time lock', () => {
  const expectLocked = async (useCase: ManageTotp, code: string): Promise<void> => {
    const result = await useCase.confirm(CREDENTIAL_ID, code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');
  };

  it('uses the owner-decided durations: 5, 15 and then 60 minutes', () => {
    expect(TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL).toEqual([5, 15, 60]);
  });

  it('escalates 5 -> 15 -> 60 -> 60 minutes, locking one millisecond short and releasing on time', async () => {
    const { useCase, advanceClock } = buildUseCase();
    const durations = [
      FIRST_LOCK_MS,
      SECOND_LOCK_MS,
      THIRD_AND_LATER_LOCK_MS,
      THIRD_AND_LATER_LOCK_MS,
    ];

    for (const duration of durations) {
      // Tras el desbloqueo anterior, el primer fallo del ciclo se acepta (y cuenta) en el instante exacto.
      const errors = await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
      expect(errors.every((error) => error.code === 'CREDENTIAL.TOTP_CODE_INVALID')).toBe(true);

      advanceClock(duration - 1);
      await expectLocked(useCase, WRONG_CODE);
      advanceClock(1);
    }

    // Tras el último desbloqueo todavía se aceptan intentos.
    const [unlocked] = await failTimes(useCase, 1);
    expect(unlocked?.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
  });

  it('counts the maximum failures again after a lock expires', async () => {
    const { useCase, advanceClock, correctCodeNow, markVerified } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    advanceClock(FIRST_LOCK_MS);

    // Nueve fallos tras expirar no bloquean todavía: la cuenta volvió a cero.
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES - 1);
    const result = await useCase.confirm(CREDENTIAL_ID, correctCodeNow());

    expect(result.ok).toBe(true);
    expect(markVerified).toHaveBeenCalledTimes(1);
  });

  it('does not confirm with the correct code while locked, and the lock does not shorten', async () => {
    const { useCase, advanceClock, correctCodeNow, markVerified, auditDenial } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);

    await expectLocked(useCase, correctCodeNow());
    advanceClock(FIRST_LOCK_MS - 1);
    await expectLocked(useCase, correctCodeNow());

    expect(markVerified).not.toHaveBeenCalled();
    expect(auditDenial).toHaveBeenCalledTimes(2);
  });

  it('keeps the escalation level when only wrong codes are tried while locked', async () => {
    const { useCase, advanceClock } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    // Insistir durante el bloqueo no suma fallos ni alarga ni escala el bloqueo.
    await expectLocked(useCase, WRONG_CODE);
    await expectLocked(useCase, WRONG_CODE);
    advanceClock(FIRST_LOCK_MS);

    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);

    // El segundo bloqueo es de 15 min: a los 5 min sigue bloqueado.
    advanceClock(FIRST_LOCK_MS);
    await expectLocked(useCase, WRONG_CODE);
  });

  it('clears the count and the escalation with a correct confirmation after the lock expires', async () => {
    const { useCase, advanceClock, correctCodeNow, startNewRegistration } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    advanceClock(FIRST_LOCK_MS);
    expect((await useCase.confirm(CREDENTIAL_ID, correctCodeNow())).ok).toBe(true);

    // Un registro nuevo (misma versión simulada: pendiente otra vez) debe empezar sin escalamiento: si el
    // acierto no hubiera limpiado el nivel, este bloqueo duraría 15 min y no 5.
    startNewRegistration(1);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    advanceClock(FIRST_LOCK_MS);
    const [unlocked] = await failTimes(useCase, 1);

    expect(unlocked?.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
  });

  it('starts everything from zero, level included, when the second factor is registered again', async () => {
    const { useCase, advanceClock, correctCodeNow, startNewRegistration } = buildUseCase(1);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    advanceClock(FIRST_LOCK_MS);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    // Bloqueado por segunda vez (15 min), sin esperar.
    await expectLocked(useCase, correctCodeNow());

    startNewRegistration(2);
    expect((await useCase.confirm(CREDENTIAL_ID, correctCodeNow())).ok).toBe(true);

    // Y el registro 3 vuelve a empezar en el primer escalón (5 min).
    startNewRegistration(3);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    advanceClock(FIRST_LOCK_MS);
    const [unlocked] = await failTimes(useCase, 1);
    expect(unlocked?.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
  });

  it('answers the lock with the same error code whatever the level', async () => {
    const { useCase, advanceClock } = buildUseCase();
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    const first = await useCase.confirm(CREDENTIAL_ID, WRONG_CODE);
    advanceClock(FIRST_LOCK_MS);
    await failTimes(useCase, TOTP_CONFIRM_MAX_FAILURES);
    const second = await useCase.confirm(CREDENTIAL_ID, WRONG_CODE);

    if (first.ok || second.ok) throw new Error('A locked registration must not confirm');
    expect(second.error.code).toBe(first.error.code);
    expect(second.error.message).toBe(first.error.message);
    expect(second.error.meta).toEqual(first.error.meta);
  });
});
