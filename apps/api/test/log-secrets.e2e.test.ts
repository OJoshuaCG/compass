import { Writable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment } from './support/e2e.js';

const EMAIL = 'owner@logs.test';
const NEW_PASSWORD = 'Another-Strong-Passphrase-77';

// Valores conocidos que no deben aparecer jamás en los logs capturados (plan, "Logs").
const WRONG_PASSWORD_CANARY = 'Canary-Wrong-Password-4821';
const WRONG_CURRENT_PASSWORD_CANARY = 'Canary-Wrong-Current-9937';
const WRONG_RECOVERY_CODE_CANARY = 'QZXW-CANA-RYKW';
const CONTROL_SECRET_CANARY = 'Canary-Control-Secret-5560';

const capturedLines: string[] = [];
const logDestination = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    capturedLines.push(chunk.toString('utf8'));
    callback();
  },
});

let env: E2eEnvironment;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { logDestination });
  await env.bootstrapOrganization({
    slug: 'logs',
    rootEmail: EMAIL,
    rootName: 'Grace Hopper',
    keepInitialPassword: true,
  });
});

afterAll(async () => {
  await env.close();
});

describe('sensitive endpoints never leak secrets into the logs', () => {
  const knownSecrets: string[] = [
    STRONG_PASSWORD,
    NEW_PASSWORD,
    WRONG_PASSWORD_CANARY,
    WRONG_CURRENT_PASSWORD_CANARY,
    WRONG_RECOVERY_CODE_CANARY,
  ];

  it('captures real log lines, so the absence checks below are meaningful', () => {
    // Control positivo: si el destino no recibiera nada, las pruebas de ausencia pasarían vacías.
    env.logger.info(
      { password: CONTROL_SECRET_CANARY, nested: { token: CONTROL_SECRET_CANARY } },
      'log capture control',
    );

    const captured = capturedLines.join('');
    expect(captured).toContain('log capture control');
    expect(captured).toContain('[Redacted]');
    expect(captured).not.toContain(CONTROL_SECRET_CANARY);
  });

  it('keeps passwords, second-factor secrets and recovery codes out of the logs', async () => {
    const owner = new TestClient(env);

    await owner.post('/auth/login', { email: EMAIL, password: WRONG_PASSWORD_CANARY });
    await owner.post('/auth/login', { email: EMAIL, password: STRONG_PASSWORD });
    await owner.post('/auth/password/change', {
      currentPassword: WRONG_CURRENT_PASSWORD_CANARY,
      newPassword: NEW_PASSWORD,
    });
    await owner.post('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    const enrolled = await enroll(env, owner);
    await owner.post('/auth/mfa/recovery', { code: WRONG_RECOVERY_CODE_CANARY });

    const secretsFromTheSystem = [enrolled.secret, ...enrolled.recoveryCodes];
    const captured = capturedLines.join('');

    for (const secret of [...knownSecrets, ...secretsFromTheSystem]) {
      expect(captured.includes(secret), 'a secret appeared in the logs').toBe(false);
    }
  });
});
