import { Writable } from 'node:stream';

import type {
  Account,
  Credential,
  CredentialTotp,
  ExportedTotp,
  ProblemDetails,
  Role,
  TotpCode,
} from '@iam/contracts';
import { TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL, TOTP_CONFIRM_MAX_FAILURES } from '@iam/contracts';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B4a: segundo factor (TOTP) de las credenciales de la bóveda. Registro desde un URI otpauth,
// confirmación, código bajo demanda con tope, exportación con reautenticación y motivo, re-registro y retiro.
const REAUTH_WINDOW_MS = 6 * 60 * 1000;
const CODE_WINDOW_MS = 61_000;
const CODES_PER_MINUTE = 10;
const PERIOD_SECONDS = 30;
const NEXT_CODE_THRESHOLD_SECONDS = 5;
const VALID_REASON = 'Moving the code generator to the new team phone';

// Claves de 160 bits que no deben aparecer nunca en listados, auditoría ni registros.
const SECRET_CANARY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SECOND_SECRET_CANARY = 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U';
const SHORT_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVG';

const otpauth = (secret: string, extra = ''): string =>
  `otpauth://totp/Brand:ada@brand.example?secret=${secret}&issuer=Brand${extra}`;

const capturedLines: string[] = [];
const logDestination = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    capturedLines.push(chunk.toString('utf8'));
    callback();
  },
});

let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let owner: EnrolledSession;
let editor: EnrolledSession;
let viewer: EnrolledSession;
let useOnly: EnrolledSession;
let manager: EnrolledSession;
let stranger: EnrolledSession;
let account: Account;

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const shareAccount = async (
  accountId: string,
  email: string,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
): Promise<void> => {
  const grantor = await userId('root@totp.test');
  await env.db.admin.query(
    `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
     values ($1, 'account', $2, 'user', $3, $4, $5)`,
    [orgId, accountId, await userId(email), level, grantor],
  );
};

const reauth = async (who: EnrolledSession): Promise<void> => {
  const response = await who.client.post('/auth/reauth', {
    code: freshTotp(who.secret, env.clock),
  });
  expect(response.status).toBe(204);
};

const auditRows = async (action: string, targetId?: string) =>
  (
    await env.db.admin.query<{
      target_id: string | null;
      reason_code: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      `select target_id, reason_code, outcome, metadata from audit_events
        where organization_id = $1 and action = $2 and ($3::uuid is null or target_id = $3::uuid)
        order by seq`,
      [orgId, action, targetId ?? null],
    )
  ).rows;

const newCredential = async (label: string): Promise<Credential> => {
  const response = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
    label,
    username: 'totp-user@brand.example',
    password: 'Canary-Vault-Password-5512',
  });
  expect(response.status).toBe(201);
  return response.body;
};

const register = <Body = ProblemDetails>(who: EnrolledSession, credentialId: string, uri: string) =>
  who.client.post<Body>(`/credentials/${credentialId}/totp`, { otpauthUri: uri });

/** Código que debe dar la plataforma ahora mismo, calculado con la misma librería y el reloj de la prueba. */
const expectedCode = (secret: string, digits = 6, period = PERIOD_SECONDS): string =>
  generateSync({
    secret,
    strategy: 'totp',
    digits,
    period,
    epoch: Math.floor(env.clock.now().getTime() / 1000),
  });

const requestCode = (who: EnrolledSession, credentialId: string) =>
  who.client.post<TotpCode & ProblemDetails>(`/credentials/${credentialId}/totp/code`, {});

/** Deja el reloj a `seconds` segundos de que venza el periodo vigente. */
const advanceToSecondsBeforePeriodEnd = (seconds: number): void => {
  const nowMs = env.clock.now().getTime();
  const intoPeriodMs = nowMs % (PERIOD_SECONDS * 1000);
  env.clock.advance(PERIOD_SECONDS * 1000 - intoPeriodMs - seconds * 1000);
};

/** Credencial con el segundo factor ya registrado y confirmado. */
const verifiedCredential = async (label: string, secret = SECRET_CANARY): Promise<Credential> => {
  const created = await newCredential(label);
  expect((await register(owner, created.id, otpauth(secret))).status).toBe(201);
  const confirmed = await owner.client.post<CredentialTotp>(
    `/credentials/${created.id}/totp/confirm`,
    { code: expectedCode(secret) },
  );
  expect(confirmed.status).toBe(200);
  return created;
};

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { logDestination });
  const created = await env.bootstrapOrganization({
    slug: 'totp',
    rootEmail: 'root@totp.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.90');
  await rootClient.post('/auth/login', { email: 'root@totp.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';
  const invite = (email: string, rank: 1 | 2 | 3, roleName: string) =>
    inviteAndOnboard(env, root.client, { email, rank, roleIds: [roleId(roleName)] });

  owner = await invite('owner@totp.test', 3, 'Operator');
  editor = await invite('editor@totp.test', 2, 'Leader');
  viewer = await invite('viewer@totp.test', 2, 'Leader');
  useOnly = await invite('use@totp.test', 2, 'Leader');
  manager = await invite('manager@totp.test', 2, 'Leader');
  stranger = await invite('stranger@totp.test', 2, 'Leader');

  const platforms = await owner.client.get<{ data: { id: string; slug: string }[] }>('/platforms');
  const instagramId =
    platforms.body.data.find((platform) => platform.slug === 'instagram')?.id ?? '';
  account = (
    await owner.client.post<Account>('/accounts', {
      platformId: instagramId,
      displayName: 'Brand Instagram',
    })
  ).body;
  await shareAccount(account.id, 'editor@totp.test', 'EDIT');
  await shareAccount(account.id, 'viewer@totp.test', 'VIEW');
  await shareAccount(account.id, 'use@totp.test', 'USE');
  await shareAccount(account.id, 'manager@totp.test', 'MANAGE');
});

afterAll(async () => {
  await env.close();
});

describe('registering the second factor', () => {
  it('rejects URIs that are not safe TOTP and never echoes the key', async () => {
    const credential = await newCredential('Invalid URIs');
    const cases: Record<string, string> = {
      hotp: `otpauth://hotp/Brand:ada?secret=${SECRET_CANARY}&counter=1`,
      'a key under 128 bits': otpauth(SHORT_SECRET),
      'a 7 digit code': otpauth(SECRET_CANARY, '&digits=7'),
      'an unsupported algorithm': otpauth(SECRET_CANARY, '&algorithm=MD5'),
      'a 45 s period': otpauth(SECRET_CANARY, '&period=45'),
      // 27 caracteres Base32 (135 bits): alfabeto y longitud válidos, pero no decodificable.
      'a secret that cannot be decoded': otpauth('GEZDGNBVGY3TQOJQGEZDGNBVGY3'),
    };
    for (const [name, uri] of Object.entries(cases)) {
      const response = await register(owner, credential.id, uri);
      expect(response.status, name).toBe(422);
      expect(response.body.code, name).toBe('CREDENTIAL.TOTP_URI_INVALID');
      expect(JSON.stringify(response.body), name).not.toContain(SECRET_CANARY);
      expect(JSON.stringify(response.body), name).not.toContain(SHORT_SECRET);
    }
    const stored = await env.db.admin.query(
      "select 1 from credential_secrets where credential_id = $1 and field = 'totp_uri'",
      [credential.id],
    );
    expect(stored.rowCount).toBe(0);
  });

  it('stores only ciphertext, starts as pending and audits without the key', async () => {
    const credential = await newCredential('Stored encrypted');
    const response = await register<CredentialTotp>(owner, credential.id, otpauth(SECRET_CANARY));
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      status: 'pending',
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      verifiedAt: null,
      exposed: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(SECRET_CANARY);

    const secrets = await env.db.admin.query<{ ciphertext: Buffer; version: number }>(
      "select ciphertext, version from credential_secrets where credential_id = $1 and field = 'totp_uri'",
      [credential.id],
    );
    expect(secrets.rowCount).toBe(1);
    expect(secrets.rows[0]?.version).toBe(1);
    expect(secrets.rows[0]?.ciphertext.includes(Buffer.from(SECRET_CANARY))).toBe(false);

    const kind = await env.db.admin.query<{ kind: string }>(
      'select kind from credentials where id = $1',
      [credential.id],
    );
    expect(kind.rows[0]?.kind).toBe('password_totp');

    const events = await auditRows('credential.totp_registered', credential.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ algorithm: 'SHA1', digits: 6, period: 30 });
    expect(JSON.stringify(events)).not.toContain(SECRET_CANARY);
  });

  it('shows the status without the key and leaves the credential listing clean', async () => {
    const credential = await newCredential('Status only');
    await register(owner, credential.id, otpauth(SECRET_CANARY));
    const status = await owner.client.get<CredentialTotp>(`/credentials/${credential.id}/totp`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('pending');
    expect(JSON.stringify(status.body)).not.toContain(SECRET_CANARY);

    const listing = await owner.client.get(`/accounts/${account.id}/credentials`);
    expect(JSON.stringify(listing.body)).not.toContain(SECRET_CANARY);
  });

  it('requires EDIT: USE and VIEW are denied (audited) and no access looks like not found', async () => {
    const credential = await newCredential('Registration access');
    for (const who of [useOnly, viewer]) {
      const response = await register(who, credential.id, otpauth(SECRET_CANARY));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('AUTHZ.SHARE');
    }
    const asStranger = await register(stranger, credential.id, otpauth(SECRET_CANARY));
    expect(asStranger.status).toBe(404);
    expect((await register(editor, credential.id, otpauth(SECRET_CANARY))).status).toBe(201);
  });
});

describe('confirming the second factor', () => {
  it('moves pending to verified only with the code the platform shows', async () => {
    const credential = await newCredential('Confirmation');
    await register(owner, credential.id, otpauth(SECRET_CANARY));

    const wrong = await owner.client.post<ProblemDetails>(
      `/credentials/${credential.id}/totp/confirm`,
      { code: expectedCode(SECOND_SECRET_CANARY) },
    );
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
    const stillPending = await owner.client.get<CredentialTotp>(
      `/credentials/${credential.id}/totp`,
    );
    expect(stillPending.body.status).toBe('pending');
    const failures = (await auditRows('credential.totp_confirmed', credential.id)).filter(
      (row) => row.outcome === 'failure',
    );
    expect(failures).toHaveLength(1);

    const confirmed = await owner.client.post<CredentialTotp>(
      `/credentials/${credential.id}/totp/confirm`,
      { code: expectedCode(SECRET_CANARY) },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('verified');
    expect(confirmed.body.verifiedAt).not.toBeNull();

    const again = await owner.client.post<ProblemDetails>(
      `/credentials/${credential.id}/totp/confirm`,
      { code: expectedCode(SECRET_CANARY) },
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CREDENTIAL.TOTP_STATE_INVALID');
  });

  it('requires EDIT', async () => {
    const credential = await newCredential('Confirmation access');
    await register(owner, credential.id, otpauth(SECRET_CANARY));
    const asUseOnly = await useOnly.client.post<ProblemDetails>(
      `/credentials/${credential.id}/totp/confirm`,
      { code: expectedCode(SECRET_CANARY) },
    );
    expect(asUseOnly.status).toBe(403);
    expect(asUseOnly.body.code).toBe('AUTHZ.SHARE');
  });
});

// SENSIBLE (revisión humana)
describe('confirmation attempt limit', () => {
  const confirm = (credentialId: string, code: string) =>
    owner.client.post<ProblemDetails>(`/credentials/${credentialId}/totp/confirm`, {
      code,
    });

  it('locks the pending registration after the maximum failures and audits the denial', async () => {
    const credential = await newCredential('Confirmation lock');
    await register(owner, credential.id, otpauth(SECRET_CANARY));
    const wrongCode = expectedCode(SECOND_SECRET_CANARY);

    for (let attempt = 0; attempt < TOTP_CONFIRM_MAX_FAILURES; attempt += 1) {
      const rejected = await confirm(credential.id, wrongCode);
      expect(rejected.status).toBe(422);
      expect(rejected.body.code).toBe('CREDENTIAL.TOTP_CODE_INVALID');
    }

    // Agotado, ni el código correcto confirma ese registro.
    const locked = await confirm(credential.id, expectedCode(SECRET_CANARY));
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');
    const stillPending = await owner.client.get<CredentialTotp>(
      `/credentials/${credential.id}/totp`,
    );
    expect(stillPending.body.status).toBe('pending');

    const failures = (await auditRows('credential.totp_confirmed', credential.id)).filter(
      (row) => row.outcome === 'failure',
    );
    expect(failures).toHaveLength(TOTP_CONFIRM_MAX_FAILURES);
    const denials = (await auditRows('authz.denied', account.id)).filter(
      (row) => row.reason_code === 'CREDENTIAL.TOTP_CONFIRM_LOCKED',
    );
    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(denials)).not.toContain(SECRET_CANARY);

    // Registrar de nuevo abre un registro nuevo (sin bloqueo ni escalamiento), que sí se puede confirmar.
    expect((await register(owner, credential.id, otpauth(SECRET_CANARY))).status).toBe(201);
    const confirmed = await confirm(credential.id, expectedCode(SECRET_CANARY));
    expect(confirmed.status).toBe(200);
    const verified = await owner.client.get<CredentialTotp>(`/credentials/${credential.id}/totp`);
    expect(verified.body.status).toBe('verified');
  });
});

describe('issuing codes on demand', () => {
  it('returns the current code with its remaining seconds and audits it without the code', async () => {
    const credential = await verifiedCredential('Codes');
    advanceToSecondsBeforePeriodEnd(20);
    const response = await requestCode(useOnly, credential.id);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.code).toBe(expectedCode(SECRET_CANARY));
    expect(response.body.expiresIn).toBeGreaterThan(NEXT_CODE_THRESHOLD_SECONDS);
    expect(response.body.expiresIn).toBeLessThanOrEqual(20);
    expect(response.body.nextCode).toBeUndefined();

    const events = await auditRows('credential.totp_code_issued', credential.id);
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(response.body.code);
  });

  it('adds the next code when fewer than 5 seconds remain', async () => {
    const credential = await verifiedCredential('Next code');
    advanceToSecondsBeforePeriodEnd(2);
    const response = await requestCode(viewer, credential.id);
    expect(response.status).toBe(200);
    expect(response.body.expiresIn).toBeLessThan(NEXT_CODE_THRESHOLD_SECONDS);
    expect(response.body.code).toBe(expectedCode(SECRET_CANARY));
    env.clock.advance(response.body.expiresIn * 1000);
    expect(response.body.nextCode).toBe(expectedCode(SECRET_CANARY));
  });

  it('honours 8 digits and a 60 s period from the registered URI', async () => {
    const credential = await newCredential('Eight digits');
    const uri = otpauth(SECRET_CANARY, '&digits=8&period=60');
    expect((await register(owner, credential.id, uri)).status).toBe(201);
    const response = await requestCode(owner, credential.id);
    expect(response.status).toBe(200);
    expect(response.body.code).toBe(expectedCode(SECRET_CANARY, 8, 60));
    expect(response.body.code).toHaveLength(8);
  });

  it('limits codes per person and credential per minute, then recovers', async () => {
    const credential = await verifiedCredential('Limited codes');
    for (let issued = 0; issued < CODES_PER_MINUTE; issued += 1) {
      expect((await requestCode(useOnly, credential.id)).status).toBe(200);
    }
    const blocked = await requestCode(useOnly, credential.id);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('CREDENTIAL.TOTP_CODE_LIMIT');

    // Otra persona, y otra credencial de la misma persona, no comparten el tope.
    expect((await requestCode(viewer, credential.id)).status).toBe(200);
    const other = await verifiedCredential('Other credential');
    expect((await requestCode(useOnly, other.id)).status).toBe(200);

    env.clock.advance(CODE_WINDOW_MS);
    expect((await requestCode(useOnly, credential.id)).status).toBe(200);
  });

  it('needs USE; a stranger sees not found; a retired factor gives no code', async () => {
    const credential = await verifiedCredential('Code access');
    expect((await requestCode(stranger, credential.id)).status).toBe(404);

    const noTotp = await newCredential('No second factor');
    expect((await requestCode(owner, noTotp.id)).status).toBe(404);

    expect((await owner.client.post(`/credentials/${credential.id}/totp/retire`, {})).status).toBe(
      200,
    );
    const retired = await requestCode(owner, credential.id);
    expect(retired.status).toBe(409);
    expect(retired.body.code).toBe('CREDENTIAL.TOTP_STATE_INVALID');
  });
});

describe('exporting the secret', () => {
  const exportSecret = (who: EnrolledSession, credentialId: string, reason?: string) =>
    who.client.post<ExportedTotp & ProblemDetails>(
      `/credentials/${credentialId}/totp/export`,
      reason === undefined ? {} : { reason },
    );

  it('demands a fresh reauthentication', async () => {
    const credential = await verifiedCredential('Export reauth');
    env.clock.advance(REAUTH_WINDOW_MS);
    const response = await exportSecret(manager, credential.id, VALID_REASON);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
  });

  it('demands a written reason and audits the denial', async () => {
    const credential = await verifiedCredential('Export reason');
    await reauth(manager);
    for (const reason of [undefined, '', 'short', '   ']) {
      const response = await exportSecret(manager, credential.id, reason);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('CREDENTIAL.REASON_INVALID');
    }
    expect(await auditRows('credential.totp_exported', credential.id)).toHaveLength(0);
  });

  it('needs MANAGE and the catalog permission; EDIT and an Operator are denied', async () => {
    const credential = await verifiedCredential('Export access');
    await reauth(editor);
    const asEditor = await exportSecret(editor, credential.id, VALID_REASON);
    expect(asEditor.status).toBe(403);
    expect(asEditor.body.code).toBe('AUTHZ.SHARE');

    await reauth(owner);
    const asOperator = await exportSecret(owner, credential.id, VALID_REASON);
    expect(asOperator.status).toBe(403);
    expect(asOperator.body.code).toBe('AUTHZ.PERMISSION');

    await reauth(stranger);
    expect((await exportSecret(stranger, credential.id, VALID_REASON)).status).toBe(404);
  });

  it('shows the key, marks it exposed, audits with the reason and opens one rotation task', async () => {
    const credential = await verifiedCredential('Export ok');
    await reauth(manager);
    const response = await exportSecret(manager, credential.id, VALID_REASON);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.secretKey).toBe(SECRET_CANARY);
    expect(response.body.otpauthUri).toContain(`secret=${SECRET_CANARY}`);

    const status = await manager.client.get<CredentialTotp>(`/credentials/${credential.id}/totp`);
    expect(status.body.exposed).toBe(true);
    const health = await env.db.admin.query<{ health: Record<string, unknown> }>(
      'select health from credentials where id = $1',
      [credential.id],
    );
    expect(health.rows[0]?.health).toHaveProperty('totpExposedAt');

    const events = await auditRows('credential.totp_exported', credential.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('success');
    expect(events[0]?.metadata).toEqual({ reason: VALID_REASON });
    expect(JSON.stringify(events)).not.toContain(SECRET_CANARY);

    await reauth(manager);
    expect((await exportSecret(manager, credential.id, VALID_REASON)).status).toBe(200);
    const tasks = await env.db.admin.query<{ trigger: string; priority: string }>(
      'select trigger, priority from rotation_tasks where credential_id = $1',
      [credential.id],
    );
    expect(tasks.rows).toEqual([{ trigger: 'totp_exported', priority: 'high' }]);
  });
});

describe('re-registering and retiring', () => {
  it('keeps the previous secret as a non-current version and goes back to pending', async () => {
    const credential = await verifiedCredential('Re-register');
    const response = await register<CredentialTotp>(
      editor,
      credential.id,
      otpauth(SECOND_SECRET_CANARY),
    );
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('pending');
    expect(response.body.verifiedAt).toBeNull();

    const versions = await env.db.admin.query<{ version: number; is_current: boolean }>(
      "select version, is_current from credential_secrets where credential_id = $1 and field = 'totp_uri' order by version",
      [credential.id],
    );
    expect(versions.rows).toEqual([
      { version: 1, is_current: false },
      { version: 2, is_current: true },
    ]);

    const events = await auditRows('credential.totp_reregistered', credential.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({ previousVersion: 1 });

    const confirmed = await editor.client.post<CredentialTotp>(
      `/credentials/${credential.id}/totp/confirm`,
      { code: expectedCode(SECOND_SECRET_CANARY) },
    );
    expect(confirmed.status).toBe(200);
  });

  it('clears the exposed mark when a new secret replaces the exported one', async () => {
    const credential = await verifiedCredential('Re-register after export');
    await reauth(manager);
    await manager.client.post(`/credentials/${credential.id}/totp/export`, {
      reason: VALID_REASON,
    });
    await register(editor, credential.id, otpauth(SECOND_SECRET_CANARY));
    const status = await editor.client.get<CredentialTotp>(`/credentials/${credential.id}/totp`);
    expect(status.body.exposed).toBe(false);
  });

  it('keeps the exposed mark when the same secret is registered again', async () => {
    const credential = await verifiedCredential('Re-register same secret');
    await reauth(manager);
    await manager.client.post(`/credentials/${credential.id}/totp/export`, {
      reason: VALID_REASON,
    });
    await register(editor, credential.id, otpauth(SECRET_CANARY));
    const status = await editor.client.get<CredentialTotp>(`/credentials/${credential.id}/totp`);
    expect(status.body.exposed).toBe(true);
    const health = await env.db.admin.query<{ health: Record<string, unknown> }>(
      'select health from credentials where id = $1',
      [credential.id],
    );
    expect(health.rows[0]?.health).toHaveProperty('totpExposedAt');
  });

  it('marks the retirement in the credential health and clears it on re-registering', async () => {
    const credential = await verifiedCredential('Retire health');
    await editor.client.post(`/credentials/${credential.id}/totp/retire`, {});
    const readHealth = async () =>
      (
        await env.db.admin.query<{ health: Record<string, unknown> }>(
          'select health from credentials where id = $1',
          [credential.id],
        )
      ).rows[0]?.health;
    expect(await readHealth()).toHaveProperty('totpRetiredAt');

    await register(editor, credential.id, otpauth(SECOND_SECRET_CANARY));
    expect(await readHealth()).not.toHaveProperty('totpRetiredAt');
  });

  it('retires with EDIT, audits it and refuses to retire twice', async () => {
    const credential = await verifiedCredential('Retire');
    const asUseOnly = await useOnly.client.post<ProblemDetails>(
      `/credentials/${credential.id}/totp/retire`,
      {},
    );
    expect(asUseOnly.status).toBe(403);

    const retired = await editor.client.post<CredentialTotp>(
      `/credentials/${credential.id}/totp/retire`,
      {},
    );
    expect(retired.status).toBe(200);
    expect(retired.body.status).toBe('retired');
    expect(await auditRows('credential.totp_retired', credential.id)).toHaveLength(1);

    const twice = await editor.client.post<ProblemDetails>(
      `/credentials/${credential.id}/totp/retire`,
      {},
    );
    expect(twice.status).toBe(409);
  });
});

// SENSIBLE (revisión humana)
// Va al final del archivo a propósito: avanza el reloj compartido decenas de minutos y los límites por
// minuto de otras pruebas cuentan eventos de auditoría con la hora real de la base.
describe('confirmation timed lock', () => {
  const MILLISECONDS_PER_MINUTE = 60 * 1000;
  const confirm = (credentialId: string, code: string) =>
    owner.client.post<ProblemDetails>(`/credentials/${credentialId}/totp/confirm`, {
      code,
    });

  it('releases the lock by time without registering again, and escalates the second lock', async () => {
    const credential = await newCredential('Confirmation timed lock');
    await register(owner, credential.id, otpauth(SECRET_CANARY));
    const firstLockMs = (TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL[0] ?? 0) * MILLISECONDS_PER_MINUTE;
    const secondLockMs = (TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL[1] ?? 0) * MILLISECONDS_PER_MINUTE;
    const wrongCode = expectedCode(SECOND_SECRET_CANARY);

    for (let attempt = 0; attempt < TOTP_CONFIRM_MAX_FAILURES; attempt += 1) {
      expect((await confirm(credential.id, wrongCode)).status).toBe(422);
    }
    env.clock.advance(firstLockMs - 1);
    const stillLocked = await confirm(credential.id, expectedCode(SECRET_CANARY));
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.body.code).toBe('CREDENTIAL.TOTP_CONFIRM_LOCKED');

    // Vencido el primer bloqueo se vuelven a contar los fallos y el segundo bloqueo dura más.
    env.clock.advance(1);
    for (let attempt = 0; attempt < TOTP_CONFIRM_MAX_FAILURES; attempt += 1) {
      expect((await confirm(credential.id, expectedCode(SECOND_SECRET_CANARY))).status).toBe(422);
    }
    env.clock.advance(firstLockMs);
    expect((await confirm(credential.id, expectedCode(SECRET_CANARY))).status).toBe(429);

    env.clock.advance(secondLockMs - firstLockMs);
    const confirmed = await confirm(credential.id, expectedCode(SECRET_CANARY));
    expect(confirmed.status).toBe(200);
  });
});

describe('secrets never reach the logs', () => {
  it('keeps keys, URIs and codes out of everything the API logged', () => {
    // Control positivo: sin él, la ausencia de secretos pasaría vacía si el destino no recibe nada.
    // Las claves bajo `secret` y `totp` son justo los campos que el redactor de registros debe ocultar.
    env.logger.info({ secret: SECRET_CANARY, totp: SECOND_SECRET_CANARY }, 'log capture control');
    const captured = capturedLines.join('');
    expect(captured.length).toBeGreaterThan(0);
    expect(captured).not.toContain(SECRET_CANARY);
    expect(captured).not.toContain(SECOND_SECRET_CANARY);
    expect(captured).not.toContain('otpauth://');
  });
});
