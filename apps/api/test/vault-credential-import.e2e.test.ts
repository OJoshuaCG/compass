import { Writable } from 'node:stream';

import type {
  Account,
  CredentialImportPreview,
  CredentialImportResult,
  ProblemDetails,
  Role,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// Fase 1b, B7 (O2a): importación por CSV en dos pasos. Previsualizar no escribe nada; confirmar es todo o
// nada, cifra con el módulo de criptografía y deja un solo evento de auditoría con conteos.
const DENIAL_GROUPING_WINDOW_MS = 61_000;

const USERNAME_CANARY = 'canary-import-user@brand.example';
const PASSWORD_CANARY = 'Canary-Import-Password-6630';
const HEADER = 'platform,account_name,credential_label,username,password';

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
let importer: EnrolledSession;
let stranger: EnrolledSession;
let readerOnly: EnrolledSession;

const csvOf = (...rows: string[]): string => [HEADER, ...rows].join('\r\n');
const row = (platform: string, account: string, label: string): string =>
  [platform, account, label, USERNAME_CANARY, PASSWORD_CANARY].join(',');

const previewOf = (who: EnrolledSession, csv: string) =>
  who.client.post<CredentialImportPreview & ProblemDetails>('/credentials/import/preview', { csv });
const commitOf = (who: EnrolledSession, csv: string) =>
  who.client.post<CredentialImportResult & ProblemDetails>('/credentials/import', { csv });

const auditRows = async (action: string) =>
  (
    await env.db.admin.query<{
      actor_id: string | null;
      outcome: string;
      reason_code: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select actor_id, outcome, reason_code, metadata from audit_events
        where organization_id = $1 and action = $2 order by seq`,
      [orgId, action],
    )
  ).rows;

const accountsNamed = async (displayName: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ total: string }>(
        'select count(*)::text as total from accounts where organization_id = $1 and display_name = $2',
        [orgId, displayName],
      )
    ).rows[0]?.total ?? '0',
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { logDestination });
  const created = await env.bootstrapOrganization({
    slug: 'csv-import',
    rootEmail: 'root@import.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.90');
  await rootClient.post('/auth/login', { email: 'root@import.test', password: STRONG_PASSWORD });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const operatorRoleId = roles.find((role) => role.name === 'Operator')?.id ?? '';
  // Un rol propio sin `account.create` ni `credential.create`: solo mira el inventario.
  const readerRole = await root.client.post<Role>('/roles', {
    name: 'Inventory reader',
    permissions: ['vault.inventory.read'],
  });

  importer = await inviteAndOnboard(env, root.client, {
    email: 'importer@import.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });
  stranger = await inviteAndOnboard(env, root.client, {
    email: 'stranger@import.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });
  readerOnly = await inviteAndOnboard(env, root.client, {
    email: 'reader@import.test',
    rank: 1,
    roleIds: [readerRole.body.id],
  });
  // Al aceptar la invitación se asigna además el rol de sistema de su rango, que sí trae ambos permisos:
  // se retira para que solo conserve el rol propio de solo lectura.
  await env.db.admin.query(
    `delete from user_roles
      where user_id = (select id from users where email = 'reader@import.test')
        and role_id <> $1`,
    [readerRole.body.id],
  );
});

afterAll(async () => {
  await env.close();
});

describe('previewing an import', () => {
  it('classifies each row, never echoes secrets and writes nothing', async () => {
    const response = await previewOf(
      importer,
      csvOf(
        row('instagram', 'Preview Brand', 'Main'),
        row('instagram', 'Preview Brand', 'Main'),
        row('not-a-platform', 'Preview Other', 'Main'),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      totalRows: 3,
      validRows: 1,
      invalidRows: 1,
      duplicateRows: 1,
    });
    expect(response.body.rows.map((entry) => entry.status)).toEqual([
      'valid',
      'duplicate',
      'invalid',
    ]);
    expect(response.body.rows[2]?.errorCodes).toEqual(['PLATFORM_UNKNOWN']);
    expect(JSON.stringify(response.body)).not.toContain(USERNAME_CANARY);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD_CANARY);

    expect(await accountsNamed('Preview Brand')).toBe(0);
    expect(await auditRows('credential.imported')).toHaveLength(0);
  });

  it('rejects a malformed file with a stable file-level code', async () => {
    const badHeader = await previewOf(importer, 'platform,account_name\ninstagram,Brand');
    expect(badHeader.status).toBe(422);
    expect(badHeader.body.code).toBe('CREDENTIAL_IMPORT.HEADER_INVALID');

    const unterminated = await previewOf(importer, `${HEADER}\ninstagram,"Brand,Main,u,p`);
    expect(unterminated.status).toBe(422);
    expect(unterminated.body.code).toBe('CREDENTIAL_IMPORT.MALFORMED');

    const empty = await previewOf(importer, HEADER);
    expect(empty.body.code).toBe('CREDENTIAL_IMPORT.EMPTY');
  });

  it('rejects a body that exceeds the size limit', async () => {
    const response = await previewOf(importer, 'x'.repeat(1_000_001));
    expect(response.status).toBe(422);
  });
});

describe('committing an import', () => {
  it('creates accounts and encrypted credentials, grants MANAGE and audits counts only', async () => {
    const response = await commitOf(
      importer,
      csvOf(
        row('instagram', 'Imported Brand', 'Main'),
        row('instagram', 'Imported Brand', 'Backup'),
        row('Facebook', 'Imported Page', 'Main'),
      ),
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      accountsCreated: 2,
      credentialsCreated: 3,
      duplicatesSkipped: 0,
    });

    const accounts = (await importer.client.get<{ data: Account[] }>('/accounts')).body.data;
    const brand = accounts.find((account) => account.displayName === 'Imported Brand');
    expect(brand?.myLevel).toBe('MANAGE');

    const secrets = await env.db.admin.query<{ ciphertext: Buffer; field: string }>(
      `select s.field, s.ciphertext
         from credential_secrets s
         join credentials c on c.id = s.credential_id
         join accounts a on a.id = c.account_id
        where a.organization_id = $1 and a.display_name like 'Imported %'`,
      [orgId],
    );
    expect(secrets.rows).toHaveLength(6);
    for (const secret of secrets.rows) {
      expect(secret.ciphertext.includes(Buffer.from(PASSWORD_CANARY))).toBe(false);
      expect(secret.ciphertext.includes(Buffer.from(USERNAME_CANARY))).toBe(false);
    }

    const events = await auditRows('credential.imported');
    expect(events).toHaveLength(1);
    expect(events[0]?.outcome).toBe('success');
    expect(events[0]?.metadata).toEqual({
      accountsCreated: 2,
      credentialsCreated: 3,
      duplicatesSkipped: 0,
    });
    expect(JSON.stringify(events)).not.toContain('Imported Brand');
  });

  it('gives access only to the importer: other people do not see the new accounts', async () => {
    const accounts = (await stranger.client.get<{ data: Account[] }>('/accounts')).body.data;
    expect(accounts.some((account) => account.displayName.startsWith('Imported '))).toBe(false);
  });

  it('skips accounts that already exist and repeated rows instead of duplicating them', async () => {
    const response = await commitOf(
      importer,
      csvOf(row('instagram', 'Imported Brand', 'Main'), row('instagram', 'Second Brand', 'Main')),
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      accountsCreated: 1,
      credentialsCreated: 1,
      duplicatesSkipped: 1,
    });
    expect(await accountsNamed('Imported Brand')).toBe(1);
  });

  it('is all-or-nothing: one invalid row rejects the commit with per-row codes and writes nothing', async () => {
    const eventsBefore = (await auditRows('credential.imported')).length;

    const response = await commitOf(
      importer,
      csvOf(
        row('instagram', 'Atomic Brand', 'Main'),
        row('not-a-platform', 'Atomic Broken', 'Main'),
      ),
    );

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION.FAILED');
    expect(response.body.errors).toEqual([{ field: 'line.3', code: 'PLATFORM_UNKNOWN' }]);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD_CANARY);
    expect(await accountsNamed('Atomic Brand')).toBe(0);
    expect(await auditRows('credential.imported')).toHaveLength(eventsBefore);
  });
});

describe('authorization', () => {
  it('denies preview and commit without account.create and credential.create, and audits each denial', async () => {
    for (const [endpoint, request] of [
      ['preview', previewOf],
      ['commit', commitOf],
    ] as const) {
      env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
      const before = (await auditRows('authz.denied')).length;

      const denied = await request(readerOnly, csvOf(row('instagram', 'Denied Brand', 'Main')));

      expect({ endpoint, status: denied.status, code: denied.body.code }).toEqual({
        endpoint,
        status: 403,
        code: 'AUTHZ.PERMISSION',
      });
      const after = await auditRows('authz.denied');
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)?.outcome).toBe('denied');
      expect(after.at(-1)?.reason_code).toBe('AUTHZ.PERMISSION');
    }
    expect(await accountsNamed('Denied Brand')).toBe(0);
  });

  it('requires a session', async () => {
    const anonymous = new TestClient(env, '203.0.113.91');
    const response = await anonymous.post<ProblemDetails>('/credentials/import/preview', {
      csv: csvOf(row('instagram', 'Anon Brand', 'Main')),
    });
    expect(response.status).toBe(401);
  });
});

describe('logs', () => {
  it('never contain the file content or its secrets', () => {
    // Control positivo: sin él, la ausencia de secretos pasaría vacía si el destino no recibe nada.
    env.logger.info({ password: PASSWORD_CANARY }, 'log capture control');
    const captured = capturedLines.join('');
    expect(captured.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD_CANARY, USERNAME_CANARY, 'Imported Brand']) {
      expect(captured).not.toContain(secret);
    }
  });
});
