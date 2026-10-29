import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RecoverRoot, RootRecoveryRejectedError } from './recover-root.js';
import type {
  AdministratorContact,
  RootIdentity,
  RootRecoveryOutcome,
  RootRecoveryPlan,
  RootRecoveryStore,
} from './recover-root.js';

const ROOT: RootIdentity = {
  organizationId: 'org-1',
  rootUserId: 'root-1',
  email: 'root@org.test',
  displayName: 'Ada Lovelace',
};
const ADMINISTRATORS: readonly AdministratorContact[] = [
  { email: 'a@org.test', locale: 'es-MX' },
  { email: 'b@org.test', locale: 'en-US' },
];
const FIRST_CODE = 'AAAA-BBBB-CCCC';
const SECOND_CODE = 'DDDD-EEEE-FFFF';

// Un hash que no contiene la contraseña: si el doble la incrustara en claro, la prueba de fuga no
// podría distinguir un hash de una filtración.
function fakeHash(plain: string): string {
  return `fake-hash:${createHash('sha256').update(plain).digest('hex')}`;
}

function setup(options: {
  root?: RootIdentity | null;
  outcome?: RootRecoveryOutcome;
  failedNotifications?: number;
  notifierThrows?: boolean;
  alertAuditThrows?: boolean;
  rejectionAuditThrows?: boolean;
}) {
  const plans: RootRecoveryPlan[] = [];
  const incompleteAlerts: { recipients: number; failed: number }[] = [];
  const rejections: string[] = [];
  let notifications = 0;
  const store: RootRecoveryStore = {
    recordRejection: (input) => {
      if (options.rejectionAuditThrows === true) return Promise.reject(new Error('db down'));
      rejections.push(input.rootUserId);
      return Promise.resolve();
    },
    findRoot: () => Promise.resolve(options.root === undefined ? ROOT : options.root),
    recover: (plan) => {
      plans.push(plan);
      return Promise.resolve(
        options.outcome ?? { recovered: true, administrators: ADMINISTRATORS },
      );
    },
    recordAlertIncomplete: (input) => {
      if (options.alertAuditThrows === true) return Promise.reject(new Error('db down'));
      incompleteAlerts.push({ recipients: input.recipients, failed: input.failed });
      return Promise.resolve();
    },
  };
  const useCase = new RecoverRoot({
    store,
    notifier: {
      notify: () => {
        notifications += 1;
        if (options.notifierThrows === true) return Promise.reject(new Error('smtp down'));
        return Promise.resolve(options.failedNotifications ?? 0);
      },
    },
    hasher: {
      hash: (plain) => Promise.resolve(fakeHash(plain)),
      verify: () => Promise.resolve(true),
    },
    strength: { score: () => 4 },
    primitives: {
      randomBytes: (length) => randomBytes(length),
      sha256: (data) => createHash('sha256').update(data).digest(),
    },
    now: () => new Date('2026-10-27T12:00:00Z'),
  });
  return { useCase, plans, incompleteAlerts, rejections, notifications: () => notifications };
}

const request = { organizationSlug: 'org', presentedCodes: [FIRST_CODE, SECOND_CODE] as const };

describe('RecoverRoot', () => {
  it('recupera a la Raíz: contraseña nueva de un solo uso y ocho códigos nuevos, cuatro por custodio', async () => {
    const { useCase, plans } = setup({});
    const result = await useCase.execute(request);

    expect(result.rootEmail).toBe(ROOT.email);
    expect(result.initialPassword).toMatch(/^([a-zA-Z2-9]{6}-){3}[a-zA-Z2-9]{6}$/);
    expect(result.emergencyCodes).toHaveLength(8);
    expect(new Set(result.emergencyCodes).size).toBe(8);
    expect(result.emergencyCodeGroups.filter((group) => group === 'A')).toHaveLength(4);
    expect(result.emergencyCodeGroups.filter((group) => group === 'B')).toHaveLength(4);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.recoveredAt).toEqual(new Date('2026-10-27T12:00:00Z'));
  });

  it('al almacén solo llegan hashes: ni los códigos presentados, ni los nuevos, ni la contraseña en claro', async () => {
    const { useCase, plans } = setup({});
    const result = await useCase.execute(request);

    const serialized = JSON.stringify(plans);
    expect(serialized).not.toContain(FIRST_CODE);
    expect(serialized).not.toContain(SECOND_CODE);
    expect(serialized).not.toContain(result.initialPassword);
    for (const code of result.emergencyCodes) expect(serialized).not.toContain(code);
    expect(plans[0]?.newPasswordHash).toBe(fakeHash(result.initialPassword));
  });

  it('presenta al almacén los hashes de los dos códigos normalizados', async () => {
    const { useCase, plans } = setup({});
    await useCase.execute({
      organizationSlug: 'org',
      presentedCodes: [' aaaa bbbb cccc ', 'dddd-eeee-ffff'],
    });

    const expected = [FIRST_CODE, SECOND_CODE].map((code) =>
      createHash('sha256').update(code.replace(/-/g, '')).digest('hex'),
    );
    const presented = plans[0]?.presentedCodeHashes.map((hash) =>
      Buffer.from(hash).toString('hex'),
    );
    expect(presented).toEqual(expected);
  });

  it('rechaza dos veces el mismo código sin tocar el almacén (no es control dual)', async () => {
    const { useCase, plans } = setup({});

    await expect(
      useCase.execute({ organizationSlug: 'org', presentedCodes: [FIRST_CODE, 'aaaa-bbbb-cccc'] }),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);
    expect(plans).toHaveLength(0);
  });

  it('rechaza una organización sin Raíz con el mismo mensaje que cualquier otro rechazo', async () => {
    const withoutRoot = setup({ root: null });
    const notRecovered = setup({ outcome: { recovered: false } });

    const first = await withoutRoot.useCase.execute(request).catch((error: unknown) => error);
    const second = await notRecovered.useCase.execute(request).catch((error: unknown) => error);

    expect(first).toBeInstanceOf(RootRecoveryRejectedError);
    expect(second).toBeInstanceOf(RootRecoveryRejectedError);
    expect((first as Error).message).toBe((second as Error).message);
    expect((first as RootRecoveryRejectedError).code).toBe('ROOT_RECOVERY_REJECTED');
  });

  it('si el almacén rechaza (control dual no cumplido), no avisa ni audita aviso incompleto', async () => {
    const { useCase, incompleteAlerts, notifications } = setup({ outcome: { recovered: false } });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(RootRecoveryRejectedError);
    expect(notifications()).toBe(0);
    expect(incompleteAlerts).toHaveLength(0);
  });

  it('avisa a los Administradores y no audita aviso incompleto si todos los envíos llegan', async () => {
    const { useCase, incompleteAlerts, notifications } = setup({});
    const result = await useCase.execute(request);

    expect(notifications()).toBe(1);
    expect(result.alert).toEqual({ recipients: 2, failed: 0 });
    expect(incompleteAlerts).toHaveLength(0);
  });

  it('si algún aviso falla, la recuperación sigue en pie pero queda auditado el aviso incompleto', async () => {
    const { useCase, incompleteAlerts } = setup({ failedNotifications: 1 });
    const result = await useCase.execute(request);

    expect(result.alert).toEqual({ recipients: 2, failed: 1 });
    expect(incompleteAlerts).toEqual([{ recipients: 2, failed: 1 }]);
  });

  it('audita el rechazo cuando la Raíz existe: códigos repetidos o control dual no cumplido', async () => {
    const duplicated = setup({});
    const notMet = setup({ outcome: { recovered: false } });

    await expect(
      duplicated.useCase.execute({
        organizationSlug: 'org',
        presentedCodes: [FIRST_CODE, 'aaaa-bbbb-cccc'],
      }),
    ).rejects.toBeInstanceOf(RootRecoveryRejectedError);
    await expect(notMet.useCase.execute(request)).rejects.toBeInstanceOf(RootRecoveryRejectedError);

    expect(duplicated.rejections).toEqual([ROOT.rootUserId]);
    expect(notMet.rejections).toEqual([ROOT.rootUserId]);
  });

  it('una organización sin Raíz se rechaza sin auditar (no hay organización a la que atribuirlo)', async () => {
    const { useCase, rejections } = setup({ root: null });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(RootRecoveryRejectedError);
    expect(rejections).toHaveLength(0);
  });

  it('si falla la auditoría del rechazo, quien prueba ve el mismo rechazo y no un error interno', async () => {
    const { useCase } = setup({ outcome: { recovered: false }, rejectionAuditThrows: true });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(RootRecoveryRejectedError);
  });

  it('si el aviso lanza o su auditoría falla, la contraseña y los códigos nuevos igual se entregan', async () => {
    const { useCase } = setup({ notifierThrows: true, alertAuditThrows: true });
    const result = await useCase.execute(request);

    expect(result.initialPassword).not.toBe('');
    expect(result.emergencyCodes).toHaveLength(8);
    expect(result.alert).toEqual({ recipients: 2, failed: 2 });
  });

  it('sin Administradores activos también queda auditado el aviso incompleto', async () => {
    const { useCase, incompleteAlerts } = setup({
      outcome: { recovered: true, administrators: [] },
    });
    const result = await useCase.execute(request);

    expect(result.alert).toEqual({ recipients: 0, failed: 0 });
    expect(incompleteAlerts).toEqual([{ recipients: 0, failed: 0 }]);
  });
});
