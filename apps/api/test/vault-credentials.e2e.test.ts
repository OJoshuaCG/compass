import { Writable } from 'node:stream';

import type {
  Account,
  Credential,
  PasswordVersion,
  ProblemDetails,
  RevealedPassword,
  Role,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  signIn,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B2: credenciales de la bóveda. Cifrado y huella, historial sin contenido, revelado con
// reautenticación, motivo de 6 a 500 caracteres y límite de 30 por hora (ADR 0031).
const DENIAL_GROUPING_WINDOW_MS = 61_000;
const REAUTH_WINDOW_MS = 6 * 60 * 1000;
const REVEAL_LIMIT = 30;
const LIMIT_WINDOW_MS = 60 * 60 * 1000 + 1000;
const VALID_REASON = 'Rotating the shared login for the brand page';

const USERNAME_CANARY = 'canary-user@brand.example';
const PASSWORD_CANARY = 'Canary-Vault-Password-7741';
const NEW_PASSWORD_CANARY = 'Canary-Vault-Rotated-9082';

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
let viewer: EnrolledSession;
let useOnly: EnrolledSession;
let editor: EnrolledSession;
let stranger: EnrolledSession;
let inventoryReader: EnrolledSession;
let limited: EnrolledSession;
let racer: EnrolledSession;
let instagramId: string;
let account: Account;
let credential: Credential;

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const shareAccount = async (
  accountId: string,
  email: string,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
): Promise<void> => {
  const grantor = await userId('root@creds.test');
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

const auditRows = async (action: string, actorEmail?: string) =>
  (
    await env.db.admin.query<{
      target_id: string | null;
      reason_code: string | null;
      outcome: string;
      metadata: Record<string, unknown>;
    }>(
      `select target_id, reason_code, outcome, metadata from audit_events
        where organization_id = $1 and action = $2
          and ($3::text is null or actor_id = (select id from users where email = $3))
        order by seq`,
      [orgId, action, actorEmail ?? null],
    )
  ).rows;

const newCredential = async (label: string): Promise<Credential> => {
  const response = await owner.client.post<Credential>(`/accounts/${account.id}/credentials`, {
    label,
    username: USERNAME_CANARY,
    password: PASSWORD_CANARY,
  });
  expect(response.status).toBe(201);
  return response.body;
};

const reveal = (who: EnrolledSession, credentialId: string, reason: string | undefined) =>
  who.client.post<RevealedPassword & ProblemDetails>(
    `/credentials/${credentialId}/reveal`,
    reason === undefined ? {} : { reason },
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { logDestination });
  const created = await env.bootstrapOrganization({
    slug: 'creds',
    rootEmail: 'root@creds.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.80');
  await rootClient.post('/auth/login', { email: 'root@creds.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const roleId = (name: string): string => roles.find((role) => role.name === name)?.id ?? '';
  const invite = (email: string, rank: 1 | 2 | 3, roleName: string) =>
    inviteAndOnboard(env, root.client, { email, rank, roleIds: [roleId(roleName)] });

  owner = await invite('owner@creds.test', 3, 'Operator');
  viewer = await invite('viewer@creds.test', 2, 'Leader');
  useOnly = await invite('use@creds.test', 2, 'Leader');
  editor = await invite('editor@creds.test', 2, 'Leader');
  stranger = await invite('stranger@creds.test', 2, 'Leader');
  inventoryReader = await invite('inventory@creds.test', 1, 'Administrator');
  limited = await invite('limited@creds.test', 2, 'Leader');
  racer = await invite('racer@creds.test', 2, 'Leader');

  const platforms = await owner.client.get<{ data: { id: string; slug: string }[] }>('/platforms');
  instagramId = platforms.body.data.find((platform) => platform.slug === 'instagram')?.id ?? '';
  const createdAccount = await owner.client.post<Account>('/accounts', {
    platformId: instagramId,
    displayName: 'Brand Instagram',
  });
  account = createdAccount.body;
  await shareAccount(account.id, 'viewer@creds.test', 'VIEW');
  await shareAccount(account.id, 'use@creds.test', 'USE');
  await shareAccount(account.id, 'editor@creds.test', 'EDIT');
  await shareAccount(account.id, 'limited@creds.test', 'VIEW');
  await shareAccount(account.id, 'racer@creds.test', 'VIEW');

  credential = await newCredential('Main login');
});

afterAll(async () => {
  await env.close();
});

describe('creating credentials', () => {
  it('stores ciphertext and a fingerprint, never plaintext, and audits it', async () => {
    const secrets = await env.db.admin.query<{
      field: string;
      ciphertext: Buffer;
      blind_index: Buffer | null;
    }>(
      'select field, ciphertext, blind_index from credential_secrets where credential_id = $1 order by field',
      [credential.id],
    );
    expect(secrets.rows.map((row) => row.field)).toEqual(['password', 'username']);
    for (const row of secrets.rows) {
      expect(row.ciphertext.includes(Buffer.from(PASSWORD_CANARY))).toBe(false);
      expect(row.ciphertext.includes(Buffer.from(USERNAME_CANARY))).toBe(false);
    }
    expect(secrets.rows.find((row) => row.field === 'username')?.blind_index).not.toBeNull();
    const fingerprints = await env.db.admin.query(
      'select 1 from password_fingerprints where credential_id = $1',
      [credential.id],
    );
    expect(fingerprints.rowCount).toBe(1);

    const events = (await auditRows('credential.created')).filter(
      (row) => row.target_id === credential.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ kind: 'password' });
  });

  it('answers with metadata only', async () => {
    const response = await owner.client.get<{ data: Credential[] }>(
      `/accounts/${account.id}/credentials`,
    );
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(PASSWORD_CANARY);
    expect(serialized).not.toContain(USERNAME_CANARY);
    expect(response.body.data.map((item) => item.id)).toContain(credential.id);
  });

  it('requires the EDIT level: VIEW is denied (audited) and no access looks like not found', async () => {
    const asViewer = await viewer.client.post<ProblemDetails>(
      `/accounts/${account.id}/credentials`,
      { label: 'x', username: 'u', password: 'p' },
    );
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.code).toBe('AUTHZ.SHARE');

    const asStranger = await stranger.client.post(`/accounts/${account.id}/credentials`, {
      label: 'x',
      username: 'u',
      password: 'p',
    });
    expect(asStranger.status).toBe(404);
  });
});

describe('changing the password and the history', () => {
  it('keeps versions, replaces the fingerprint and never returns content', async () => {
    const own = await newCredential('Rotated login');
    const before = await env.db.admin.query<{ hmac: Buffer }>(
      'select hmac from password_fingerprints where credential_id = $1',
      [own.id],
    );

    const changed = await editor.client.post<Credential>(`/credentials/${own.id}/password`, {
      password: NEW_PASSWORD_CANARY,
    });
    expect(changed.status).toBe(201);
    expect(changed.body.lastRotatedAt).not.toBeNull();

    const after = await env.db.admin.query<{ hmac: Buffer }>(
      'select hmac from password_fingerprints where credential_id = $1',
      [own.id],
    );
    expect(after.rows[0]?.hmac.equals(before.rows[0]?.hmac ?? Buffer.alloc(0))).toBe(false);

    const history = await editor.client.get<{ data: PasswordVersion[] }>(
      `/credentials/${own.id}/history`,
    );
    expect(history.status).toBe(200);
    expect(history.body.data.map((row) => [row.version, row.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    const serialized = JSON.stringify(history.body);
    expect(serialized).not.toContain(PASSWORD_CANARY);
    expect(serialized).not.toContain(NEW_PASSWORD_CANARY);

    const events = (await auditRows('credential.password_changed')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events.map((row) => row.metadata)).toEqual([{ version: 2 }]);
  });

  it('denies the history below EDIT', async () => {
    const asViewer = await viewer.client.get<ProblemDetails>(
      `/credentials/${credential.id}/history`,
    );
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.code).toBe('AUTHZ.SHARE');
  });
});

describe('copying the username', () => {
  it('works with USE, is audited and is not cacheable', async () => {
    const response = await useOnly.client.post<{ username: string }>(
      `/credentials/${credential.id}/username`,
    );
    expect(response.status).toBe(200);
    expect(response.body.username).toBe(USERNAME_CANARY);
    expect(response.headers['cache-control']).toBe('no-store');
    const events = await auditRows('credential.username_copied', 'use@creds.test');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(events)).not.toContain(USERNAME_CANARY);
  });

  it('answers as not found without access', async () => {
    expect((await stranger.client.post(`/credentials/${credential.id}/username`)).status).toBe(404);
  });
});

describe('revealing the password', () => {
  it('requires a fresh re-authentication', async () => {
    env.clock.advance(REAUTH_WINDOW_MS);
    const response = await reveal(viewer, credential.id, VALID_REASON);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD_CANARY);
  });

  it('requires a written reason of 6 to 500 characters and audits the denial', async () => {
    await reauth(viewer);
    for (const reason of [undefined, '12345', ' '.repeat(10), 'x'.repeat(501)]) {
      env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
      const response = await reveal(viewer, credential.id, reason);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('CREDENTIAL.REASON_INVALID');
    }
    const denials = (await auditRows('authz.denied', 'viewer@creds.test')).filter(
      (row) => row.reason_code === 'CREDENTIAL.REASON_INVALID',
    );
    expect(denials.length).toBeGreaterThanOrEqual(1);
  });

  it('reveals with a valid reason, audits it and forbids caching', async () => {
    await reauth(viewer);
    const response = await reveal(viewer, credential.id, '  123456  ');
    expect(response.status).toBe(200);
    expect(response.body.password).toBe(PASSWORD_CANARY);
    expect(response.headers['cache-control']).toBe('no-store');

    const events = await auditRows('credential.revealed', 'viewer@creds.test');
    const last = events.at(-1);
    expect(last?.outcome).toBe('success');
    expect(last?.target_id).toBe(credential.id);
    expect(last?.metadata).toEqual({ reason: '123456' });
    expect(JSON.stringify(events)).not.toContain(PASSWORD_CANARY);
  });

  it('accepts exactly 500 characters', async () => {
    await reauth(viewer);
    expect((await reveal(viewer, credential.id, 'r'.repeat(500))).status).toBe(200);
  });

  it('denies below VIEW, without access and without the permission', async () => {
    await reauth(useOnly);
    const asUse = await reveal(useOnly, credential.id, VALID_REASON);
    expect(asUse.status).toBe(403);
    expect(asUse.body.code).toBe('AUTHZ.SHARE');

    await reauth(stranger);
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    expect((await reveal(stranger, credential.id, VALID_REASON)).status).toBe(404);
    const strangerDenials = await auditRows('authz.denied', 'stranger@creds.test');
    expect(strangerDenials.some((row) => row.reason_code === 'AUTHZ.SHARE')).toBe(true);

    // El inventario solo muestra metadatos: no concede revelar.
    await reauth(inventoryReader);
    expect((await reveal(inventoryReader, credential.id, VALID_REASON)).status).toBe(404);

    // Operador: el catálogo por defecto no incluye revelar.
    const asOwner = await reveal(owner, credential.id, VALID_REASON);
    expect(asOwner.status).toBe(403);
    expect(asOwner.body.code).toBe('AUTHZ.PERMISSION');
  });

  it('treats an archived account as not found', async () => {
    const archivedAccount = (
      await owner.client.post<Account>('/accounts', {
        platformId: instagramId,
        displayName: 'To archive',
      })
    ).body;
    await shareAccount(archivedAccount.id, 'viewer@creds.test', 'VIEW');
    // Archivar es de Líder en adelante y exige MANAGE sobre la cuenta (el Operador no tiene el permiso).
    await shareAccount(archivedAccount.id, 'editor@creds.test', 'MANAGE');
    const own = (
      await owner.client.post<Credential>(`/accounts/${archivedAccount.id}/credentials`, {
        label: 'Gone',
        username: 'u',
        password: 'p',
      })
    ).body;
    expect((await editor.client.post(`/accounts/${archivedAccount.id}/archive`)).status).toBe(204);
    await reauth(viewer);
    expect((await reveal(viewer, own.id, VALID_REASON)).status).toBe(404);
  });
});

describe('the reveal limit', () => {
  it('never lets concurrent reveals exceed the quota', async () => {
    await reauth(racer);
    const alreadyUsed = REVEAL_LIMIT - 5;
    for (let count = 0; count < alreadyUsed; count += 1) {
      expect((await reveal(racer, credential.id, VALID_REASON)).status).toBe(200);
    }
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => reveal(racer, credential.id, VALID_REASON)),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(15);

    const successes = (await auditRows('credential.revealed', 'racer@creds.test')).filter(
      (row) => row.outcome === 'success',
    );
    expect(successes).toHaveLength(REVEAL_LIMIT);
  });

  it('denies the 31st reveal of the hour, flags it once and recovers after the window', async () => {
    await reauth(limited);
    for (let count = 0; count < REVEAL_LIMIT; count += 1) {
      expect((await reveal(limited, credential.id, VALID_REASON)).status).toBe(200);
    }
    const denied = await reveal(limited, credential.id, VALID_REASON);
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe('CREDENTIAL.REVEAL_LIMIT');
    expect(JSON.stringify(denied.body)).not.toContain(PASSWORD_CANARY);

    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    expect((await reveal(limited, credential.id, VALID_REASON)).status).toBe(429);

    // Un aviso crítico y un solo mensaje pendiente por ventana, aunque se insista.
    const flagged = await auditRows('credential.reveal_limit_exceeded', 'limited@creds.test');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.outcome).toBe('denied');
    expect(flagged[0]?.reason_code).toBe('CREDENTIAL.REVEAL_LIMIT');
    const notices = await env.db.admin.query(
      "select 1 from outbox_events where type = 'credential.reveal_limit_exceeded' and payload->>'actorId' = $1",
      [await userId('limited@creds.test')],
    );
    expect(notices.rowCount).toBe(1);
    // El aviso lleva el conteo y la ventana, y nada de la credencial ni del motivo (R2a).
    const noticePayload = await env.db.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from outbox_events where type = 'credential.reveal_limit_exceeded' and payload->>'actorId' = $1",
      [await userId('limited@creds.test')],
    );
    expect(noticePayload.rows[0]?.payload).toMatchObject({
      limitPerHour: REVEAL_LIMIT,
      revealedInWindow: REVEAL_LIMIT,
      windowSeconds: 3600,
    });
    expect(JSON.stringify(noticePayload.rows[0]?.payload)).not.toContain(credential.id);

    env.clock.advance(LIMIT_WINDOW_MS);
    const client = await signIn(env, 'limited@creds.test', limited.secret);
    await client.post('/auth/reauth', { code: freshTotp(limited.secret, env.clock) });
    const again = await client.post<RevealedPassword>(`/credentials/${credential.id}/reveal`, {
      reason: VALID_REASON,
    });
    expect(again.status).toBe(200);
  });
});

describe('logs', () => {
  it('never contain the credential secrets', () => {
    // Control positivo: sin él, la ausencia de secretos pasaría vacía si el destino no recibe nada.
    env.logger.info({ password: PASSWORD_CANARY }, 'log capture control');
    const captured = capturedLines.join('');
    expect(captured.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD_CANARY, NEW_PASSWORD_CANARY, USERNAME_CANARY, VALID_REASON]) {
      expect(captured).not.toContain(secret);
    }
  });
});
