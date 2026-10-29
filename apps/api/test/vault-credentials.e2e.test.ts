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
const RESTORE_ROTATION_GAP_MS = 5 * 60 * 1000;
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

const secretVersionCount = async (credentialId: string): Promise<number> => {
  const result = await env.db.admin.query<{ total: string }>(
    'select count(*)::text as total from credential_secrets where credential_id = $1',
    [credentialId],
  );
  return Number(result.rows[0]?.total ?? '0');
};

/**
 * Ejecuta una petición que debe negarse y comprueba que dejó exactamente una negación auditada
 * (`AUTHZ.SHARE`) de esa persona. Sale de la ventana de agrupación para que la negación no se colapse.
 */
const deniedAndAudited = async <T extends { status: number }>(
  actorEmail: string,
  request: () => Promise<T>,
): Promise<T> => {
  env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
  const before = (await auditRows('authz.denied', actorEmail)).length;
  const response = await request();
  const after = await auditRows('authz.denied', actorEmail);
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)?.outcome).toBe('denied');
  expect(after.at(-1)?.reason_code).toBe('AUTHZ.SHARE');
  return response;
};

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
    const asViewer = await deniedAndAudited('viewer@creds.test', () =>
      viewer.client.post<ProblemDetails>(`/accounts/${account.id}/credentials`, {
        label: 'x',
        username: 'u',
        password: 'p',
      }),
    );
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.code).toBe('AUTHZ.SHARE');

    const asStranger = await deniedAndAudited('stranger@creds.test', () =>
      stranger.client.post(`/accounts/${account.id}/credentials`, {
        label: 'x',
        username: 'u',
        password: 'p',
      }),
    );
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

  it('denies the history below EDIT and audits the denial', async () => {
    const asViewer = await deniedAndAudited('viewer@creds.test', () =>
      viewer.client.get<ProblemDetails>(`/credentials/${credential.id}/history`),
    );
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.code).toBe('AUTHZ.SHARE');

    const asStranger = await deniedAndAudited('stranger@creds.test', () =>
      stranger.client.get<ProblemDetails>(`/credentials/${credential.id}/history`),
    );
    expect(asStranger.status).toBe(404);
  });

  it('denies changing the password below EDIT or without access, audits it and changes nothing', async () => {
    const own = await newCredential('Protected login');
    const versionsBefore = await secretVersionCount(own.id);

    const asViewer = await deniedAndAudited('viewer@creds.test', () =>
      viewer.client.post<ProblemDetails>(`/credentials/${own.id}/password`, {
        password: NEW_PASSWORD_CANARY,
      }),
    );
    expect(asViewer.status).toBe(403);
    expect(asViewer.body.code).toBe('AUTHZ.SHARE');

    const asStranger = await deniedAndAudited('stranger@creds.test', () =>
      stranger.client.post<ProblemDetails>(`/credentials/${own.id}/password`, {
        password: NEW_PASSWORD_CANARY,
      }),
    );
    expect(asStranger.status).toBe(404);

    expect(await secretVersionCount(own.id)).toBe(versionsBefore);
    expect(JSON.stringify(await auditRows('authz.denied'))).not.toContain(NEW_PASSWORD_CANARY);
  });

  it('serializes concurrent password changes: versions stay consecutive and only one is current', async () => {
    // Sin el bloqueo de la fila de la credencial, dos cambios leerían la misma versión vigente y
    // chocarían con la restricción única de versión o con la de "una sola vigente" (error 500).
    const own = await newCredential('Contended login');
    const concurrentChanges = 8;
    const responses = await Promise.all(
      Array.from({ length: concurrentChanges }, (_unused, index) =>
        editor.client.post<Credential & ProblemDetails>(`/credentials/${own.id}/password`, {
          password: `${NEW_PASSWORD_CANARY}-${String(index)}`,
        }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: concurrentChanges }, () => 201),
    );

    const versions = await env.db.admin.query<{ version: number; is_current: boolean }>(
      `select version, is_current from credential_secrets
        where credential_id = $1 and field = 'password' order by version`,
      [own.id],
    );
    expect(versions.rows.map((row) => row.version)).toEqual(
      Array.from({ length: concurrentChanges + 1 }, (_unused, index) => index + 1),
    );
    expect(versions.rows.filter((row) => row.is_current)).toHaveLength(1);
    expect(versions.rows.at(-1)?.is_current).toBe(true);

    const events = (await auditRows('credential.password_changed')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events.map((row) => row.metadata.version).sort()).toEqual(
      Array.from({ length: concurrentChanges }, (_unused, index) => index + 2).sort(),
    );
  });
});

describe('restoring a password version (M2, BO-7)', () => {
  const secretRows = async (credentialId: string) =>
    (
      await env.db.admin.query<{ version: number; is_current: boolean; ciphertext: Buffer }>(
        `select version, is_current, ciphertext from credential_secrets
          where credential_id = $1 and field = 'password' order by version`,
        [credentialId],
      )
    ).rows;

  const restore = (who: EnrolledSession, credentialId: string, version: number | string) =>
    who.client.post<Credential & ProblemDetails>(
      `/credentials/${credentialId}/versions/${String(version)}/restore`,
    );

  /** Credencial con dos versiones: la 1 con PASSWORD_CANARY y la 2 (vigente) con NEW_PASSWORD_CANARY. */
  const credentialWithTwoVersions = async (label: string): Promise<Credential> => {
    const own = await newCredential(label);
    const changed = await editor.client.post(`/credentials/${own.id}/password`, {
      password: NEW_PASSWORD_CANARY,
    });
    expect(changed.status).toBe(201);
    return own;
  };

  it('creates a new current version with the old content, keeps the history and audits without secrets', async () => {
    const own = await newCredential('Restorable login');
    const fingerprintOfVersionOne = (
      await env.db.admin.query<{ hmac: Buffer }>(
        'select hmac from password_fingerprints where credential_id = $1',
        [own.id],
      )
    ).rows[0]?.hmac;
    const changed = await editor.client.post<Credential>(`/credentials/${own.id}/password`, {
      password: NEW_PASSWORD_CANARY,
    });
    expect(changed.status).toBe(201);
    const rowsBefore = await secretRows(own.id);

    // El cambio de contraseña ya dejó `lastRotatedAt` con valor, así que un `not.toBeNull()` no
    // detectaría que la restauración omite `markRotated`. Se adelanta el reloj de prueba y se exige
    // que la fecha pase a ser exactamente el instante de la restauración.
    env.clock.advance(RESTORE_ROTATION_GAP_MS);
    const restoreInstant = env.clock.now().toISOString();

    const restored = await restore(editor, own.id, 1);
    expect(restored.status).toBe(201);
    expect(restored.headers['cache-control']).toBe('no-store');
    expect(restored.body.id).toBe(own.id);
    expect(changed.body.lastRotatedAt).not.toBeNull();
    expect(restored.body.lastRotatedAt).not.toBe(changed.body.lastRotatedAt);
    expect(restored.body.lastRotatedAt).toBe(restoreInstant);
    // La respuesta son metadatos: ningún texto de contraseña.
    expect(JSON.stringify(restored.body)).not.toContain(PASSWORD_CANARY);
    expect(JSON.stringify(restored.body)).not.toContain(NEW_PASSWORD_CANARY);

    // El historial conserva todo y crece en uno: la restaurada es la 3 y la vigente.
    const history = await editor.client.get<{ data: PasswordVersion[] }>(
      `/credentials/${own.id}/history`,
    );
    expect(history.body.data.map((row) => [row.version, row.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(JSON.stringify(history.body)).not.toContain(PASSWORD_CANARY);
    expect(JSON.stringify(history.body)).not.toContain(NEW_PASSWORD_CANARY);

    // Las versiones anteriores no se tocaron: mismo texto cifrado byte a byte.
    const rowsAfter = await secretRows(own.id);
    expect(rowsAfter).toHaveLength(rowsBefore.length + 1);
    for (const before of rowsBefore) {
      const after = rowsAfter.find((row) => row.version === before.version);
      expect(after?.ciphertext.equals(before.ciphertext)).toBe(true);
    }
    // La versión nueva es un cifrado nuevo (nonce propio), no una copia de la fila vieja.
    const newRow = rowsAfter.find((row) => row.version === 3);
    const oldRow = rowsAfter.find((row) => row.version === 1);
    expect(newRow?.ciphertext.equals(oldRow?.ciphertext ?? Buffer.alloc(0))).toBe(false);

    // La huella se recalcula con el contenido restaurado: vuelve a ser la de la versión 1 (HMAC determinista
    // con la misma versión de DEK).
    const fingerprintNow = (
      await env.db.admin.query<{ hmac: Buffer }>(
        'select hmac from password_fingerprints where credential_id = $1',
        [own.id],
      )
    ).rows[0]?.hmac;
    expect(fingerprintNow?.equals(fingerprintOfVersionOne ?? Buffer.alloc(0))).toBe(true);

    // Revelar con el flujo existente devuelve el contenido de la versión 1.
    await reauth(editor);
    const revealed = await reveal(editor, own.id, VALID_REASON);
    expect(revealed.status).toBe(200);
    expect(revealed.body.password).toBe(PASSWORD_CANARY);

    const events = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('success');
    expect(events[0]?.metadata).toEqual({ restoredVersion: 1, newVersion: 3 });
    expect(JSON.stringify(events)).not.toContain(PASSWORD_CANARY);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD_CANARY);
  });

  it('denies VIEW and USE (audited) and no access looks like not found (audited), changing nothing', async () => {
    const own = await credentialWithTwoVersions('Guarded restore');
    const versionsBefore = await secretVersionCount(own.id);

    for (const email of ['viewer@creds.test', 'use@creds.test']) {
      const session = email === 'viewer@creds.test' ? viewer : useOnly;
      const denied = await deniedAndAudited(email, () => restore(session, own.id, 1));
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('AUTHZ.SHARE');
    }
    const asStranger = await deniedAndAudited('stranger@creds.test', () =>
      restore(stranger, own.id, 1),
    );
    expect(asStranger.status).toBe(404);

    expect(await secretVersionCount(own.id)).toBe(versionsBefore);
    const events = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events).toHaveLength(0);
  });

  it('rejects restoring the version that is already current, without creating a version', async () => {
    const own = await credentialWithTwoVersions('Already current');
    const versionsBefore = await secretVersionCount(own.id);

    const response = await restore(editor, own.id, 2);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CREDENTIAL.VERSION_ALREADY_CURRENT');
    expect(JSON.stringify(response.body)).not.toContain(NEW_PASSWORD_CANARY);

    expect(await secretVersionCount(own.id)).toBe(versionsBefore);
    const events = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events).toHaveLength(0);
  });

  it('answers not found for a missing version or one that belongs to another credential', async () => {
    const own = await credentialWithTwoVersions('Has two versions');
    // Esta credencial solo tiene la versión 1: la 2 existe, pero en otra credencial.
    const single = await newCredential('Has one version');
    const versionsBefore = await secretVersionCount(single.id);

    const missing = await restore(editor, own.id, 99);
    const foreign = await restore(editor, single.id, 2);
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    // Sin distinguir cuál de los dos casos es.
    expect(foreign.body.code).toBe(missing.body.code);
    expect(await secretVersionCount(single.id)).toBe(versionsBefore);
  });

  it('treats a restore on an archived account as not found, writing no version and no audit event', async () => {
    const archivedAccount = (
      await owner.client.post<Account>('/accounts', {
        platformId: instagramId,
        displayName: 'Archived before restore',
      })
    ).body;
    // Archivar exige MANAGE sobre la cuenta; EDIT bastaría para restaurar, así que `editor` recibe MANAGE.
    await shareAccount(archivedAccount.id, 'editor@creds.test', 'MANAGE');
    const own = (
      await owner.client.post<Credential>(`/accounts/${archivedAccount.id}/credentials`, {
        label: 'Archived restore',
        username: USERNAME_CANARY,
        password: PASSWORD_CANARY,
      })
    ).body;
    expect(
      (
        await editor.client.post(`/credentials/${own.id}/password`, {
          password: NEW_PASSWORD_CANARY,
        })
      ).status,
    ).toBe(201);
    const versionsBefore = await secretVersionCount(own.id);
    expect((await editor.client.post(`/accounts/${archivedAccount.id}/archive`)).status).toBe(204);

    const response = await restore(editor, own.id, 1);
    expect(response.status).toBe(404);

    expect(await secretVersionCount(own.id)).toBe(versionsBefore);
    const events = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events).toHaveLength(0);
  });

  it('answers not found to a person of another organization, writing no version and no audit event', async () => {
    const own = await credentialWithTwoVersions('Foreign restore target');
    const versionsBefore = await secretVersionCount(own.id);

    // Segunda organización con su propia Raíz (mismo patrón que el aislamiento de vault-accounts).
    await env.bootstrapOrganization({
      slug: 'creds-other',
      rootEmail: 'root@creds-other.test',
      rootName: 'Grace Hopper',
    });
    const foreignClient = new TestClient(env, '203.0.113.82');
    await foreignClient.post('/auth/login', {
      email: 'root@creds-other.test',
      password: STRONG_PASSWORD,
    });
    const foreign = await enroll(env, foreignClient);

    // La versión 1 existe, pero en otra organización: el aislamiento por filas la oculta y la
    // respuesta es la de una credencial inexistente.
    const response = await restore(foreign, own.id, 1);
    expect(response.status).toBe(404);

    expect(await secretVersionCount(own.id)).toBe(versionsBefore);
    const events = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(events).toHaveLength(0);
  });

  it('rejects a malformed version number at the edge', async () => {
    // '01' y '0x10' no son enteros canónicos; los dos últimos desbordan el entero de 32 bits.
    for (const version of ['abc', '0', '-1', '1.5', '01', '0x10', '2147483648', '99999999999']) {
      const response = await restore(editor, credential.id, version);
      expect(response.status).toBe(422);
    }
  });

  it('serializes restores with concurrent password changes: versions stay consecutive and one is current', async () => {
    const own = await credentialWithTwoVersions('Contended restore');
    const concurrentEach = 4;
    const responses = await Promise.all([
      ...Array.from({ length: concurrentEach }, (_unused, index) =>
        editor.client.post<Credential & ProblemDetails>(`/credentials/${own.id}/password`, {
          password: `${NEW_PASSWORD_CANARY}-restore-race-${String(index)}`,
        }),
      ),
      // La versión 1 nunca vuelve a ser la vigente (restaurar crea una nueva), así que todas proceden.
      ...Array.from({ length: concurrentEach }, () => restore(editor, own.id, 1)),
    ]);
    expect(responses.map((response) => response.status)).toEqual(
      Array.from({ length: concurrentEach * 2 }, () => 201),
    );

    const rows = await secretRows(own.id);
    expect(rows.map((row) => row.version)).toEqual(
      Array.from({ length: 2 + concurrentEach * 2 }, (_unused, index) => index + 1),
    );
    expect(rows.filter((row) => row.is_current)).toHaveLength(1);
    expect(rows.at(-1)?.is_current).toBe(true);

    const restoredEvents = (await auditRows('credential.version_restored')).filter(
      (row) => row.target_id === own.id,
    );
    expect(restoredEvents).toHaveLength(concurrentEach);
    expect(restoredEvents.every((row) => row.metadata.restoredVersion === 1)).toBe(true);
    const newVersions = restoredEvents.map((row) => Number(row.metadata.newVersion));
    expect(new Set(newVersions).size).toBe(concurrentEach);
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

  it('answers as not found without access and audits the attempt', async () => {
    const response = await deniedAndAudited('stranger@creds.test', () =>
      stranger.client.post(`/credentials/${credential.id}/username`),
    );
    expect(response.status).toBe(404);
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
  // El reloj de prueba es compartido y los bloques anteriores lo adelantan varios minutos cada uno: las
  // sesiones abiertas en el `beforeAll` general ya pasaron el límite de inactividad (30 min) cuando
  // llegan aquí. Se abren sesiones nuevas para estas dos personas en lugar de acortar los avances.
  beforeAll(async () => {
    racer = { ...racer, client: await signIn(env, 'racer@creds.test', racer.secret) };
    limited = { ...limited, client: await signIn(env, 'limited@creds.test', limited.secret) };
  });

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
