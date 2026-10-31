import type { Permission } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  DomainError,
  RANK,
  asOrganizationId,
  asUserId,
  err,
  ok,
} from '../../../shared/kernel/index.js';
import type { RequestContext } from '../../../shared/kernel/index.js';
import { Authorizer } from '../../access/application/authorizer.js';
import { DenialGrouper } from '../../access/application/denial-grouper.js';
import { InMemoryRoleRepository } from '../../access/testing/in-memory-role-repository.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { InMemoryUserDirectory } from '../../directory/testing/in-memory-user-directory.js';
import { ImportCredentials } from './import-credentials.js';
import type { ImportCommitOutcome } from './import-credentials.js';
import type { AccountRepository, PlatformRecord } from './ports/account-repository.js';
import type { CredentialRepository } from './ports/credential-repository.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const ACTOR_ID = asUserId('actor-1');
const HEADER = 'platform,account_name,credential_label,username,password';

const USERNAME_CANARY = 'canary-user@brand.example';
const PASSWORD_CANARY = 'Canary-Import-Password-5521';

const INSTAGRAM: PlatformRecord = {
  id: 'platform-instagram',
  name: 'Instagram',
  slug: 'instagram',
  loginUrl: null,
  supportsTotp: true,
  isGlobal: true,
};
const FACEBOOK: PlatformRecord = {
  ...INSTAGRAM,
  id: 'platform-facebook',
  name: 'Facebook',
  slug: 'facebook',
};
// Dos plataformas con el mismo nombre (una global y una propia): el texto "Twitter" es ambiguo.
const TWITTER_GLOBAL: PlatformRecord = {
  ...INSTAGRAM,
  id: 'platform-tw-1',
  name: 'Twitter',
  slug: 'twitter',
};
const TWITTER_OWN: PlatformRecord = {
  ...INSTAGRAM,
  id: 'platform-tw-2',
  name: 'Twitter',
  slug: 'twitter-own',
  isGlobal: false,
};

interface SetupOptions {
  readonly permissions?: readonly Permission[];
  readonly actorId?: typeof ACTOR_ID | null;
  readonly existingAccounts?: readonly { platformId: string; displayName: string }[];
  readonly cipherFails?: boolean;
}

function setup(options: SetupOptions = {}) {
  const log: string[] = [];
  const auditEvents: Parameters<AuditLog['record']>[0][] = [];
  const insertedAccounts: { id: string; platformId: string; displayName: string }[] = [];
  const insertedShares: { accountId: string; userId: string; level: string }[] = [];
  const insertedCredentials: { id: string; accountId: string; label: string }[] = [];
  const storedSecrets: { credentialId: string; field: string; ciphertext: Uint8Array }[] = [];
  const encryptedPlaintexts: string[] = [];
  let sequence = 0;

  const actorId = options.actorId === undefined ? ACTOR_ID : options.actorId;
  const context: RequestContext = {
    organizationId: ORGANIZATION_ID,
    actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt: null,
  };

  const directory = new InMemoryUserDirectory();
  directory.add({
    id: ACTOR_ID,
    organizationId: ORGANIZATION_ID,
    rank: RANK.OPERATOR,
    status: 'active',
    email: 'actor@example.test',
    displayName: 'Actor',
    managedBy: null,
    createdBy: null,
    locale: 'es-MX',
    timezone: 'UTC',
  });
  const roles = new InMemoryRoleRepository();
  roles.addRole({
    id: 'role-1',
    name: 'Importer',
    isSystem: false,
    permissions: options.permissions ?? ['account.create', 'credential.create'],
  });
  roles.grant(ACTOR_ID, 'role-1');

  const audit = {
    record: (input: Parameters<AuditLog['record']>[0]) => {
      log.push(`audit:${input.action}`);
      auditEvents.push(input);
      return Promise.resolve(ok({} as never));
    },
  } as unknown as AuditLog;

  const clock = { now: () => new Date('2026-10-29T12:00:00Z') };
  const authorizer = new Authorizer({
    context: { current: () => context },
    directory,
    roles,
    audit,
    clock,
    denialGrouper: new DenialGrouper(clock),
    independently: (fn) => fn(),
  });

  const accounts = {
    listPlatforms: () => {
      log.push('listPlatforms');
      return Promise.resolve([INSTAGRAM, FACEBOOK, TWITTER_GLOBAL, TWITTER_OWN]);
    },
    findVisibleKeysByNames: () => Promise.resolve(options.existingAccounts ?? []),
    insert: (account: { id: string; platformId: string; displayName: string }) => {
      log.push('account.insert');
      insertedAccounts.push(account);
      return Promise.resolve({ ...account, handle: null, ownerGroupId: null, tags: [] });
    },
    insertUserShare: (share: { accountId: string; userId: string; level: string }) => {
      log.push('share.insert');
      insertedShares.push(share);
      return Promise.resolve();
    },
  } as unknown as AccountRepository;

  const credentials = {
    insertCredential: (credential: { id: string; accountId: string; label: string }) => {
      log.push('credential.insert');
      insertedCredentials.push(credential);
      return Promise.resolve(credential);
    },
    insertSecret: (secret: { credentialId: string; field: string; ciphertext: Uint8Array }) => {
      log.push('secret.insert');
      storedSecrets.push(secret);
      return Promise.resolve();
    },
    upsertPasswordFingerprint: () => Promise.resolve(),
  } as unknown as CredentialRepository;

  const cipher = {
    encrypt: (_context: unknown, plaintext: Uint8Array) => {
      if (options.cipherFails === true) {
        return Promise.resolve(err(new DomainError('CRYPTO.KMS_UNAVAILABLE', 'KMS down')));
      }
      encryptedPlaintexts.push(new TextDecoder().decode(plaintext));
      return Promise.resolve(
        ok({
          ciphertext: new TextEncoder().encode('sealed'),
          nonce: new Uint8Array(12),
          dekVersion: 1,
        }),
      );
    },
    blindIndex: () => Promise.resolve(ok({ index: 'ab12', dekVersion: 1 })),
  } as unknown as SecretCipher;

  const importer = new ImportCredentials({
    context: { current: () => context },
    uow: { run: (fn) => fn(), runIndependent: (fn) => fn() },
    authorizer,
    accounts,
    credentials,
    cipher,
    audit,
    ids: { next: () => `id-${String(++sequence)}` },
  });

  return {
    importer,
    log,
    auditEvents,
    insertedAccounts,
    insertedShares,
    insertedCredentials,
    storedSecrets,
    encryptedPlaintexts,
  };
}

const row = (
  platform: string,
  accountName: string,
  label: string,
  username = USERNAME_CANARY,
  password = PASSWORD_CANARY,
): string => [platform, accountName, label, username, password].join(',');
const csvOf = (...rows: string[]): string => [HEADER, ...rows].join('\n');

const imported = (outcome: ImportCommitOutcome) => {
  if (outcome.status !== 'imported') throw new Error('expected the import to be committed');
  return outcome.result;
};

describe('ImportCredentials.preview', () => {
  it('classifies rows as valid, invalid and duplicate with stable codes', async () => {
    const { importer } = setup({
      existingAccounts: [{ platformId: INSTAGRAM.id, displayName: 'Already There' }],
    });
    const csv = csvOf(
      row('instagram', 'Brand', 'Main'),
      row('Instagram', 'BRAND', 'main'), // repetida en el archivo (sin distinguir mayúsculas)
      row('instagram', 'Brand', 'Backup'), // misma cuenta, otra etiqueta: es válida
      row('instagram', 'Already There', 'Main'),
      row('myspace', 'Brand', 'Main'),
      row('twitter-own', 'Other', 'Main'),
      row('Twitter', 'Other', 'Main'),
      '', // línea vacía: se descarta y no cuenta como fila
      row('facebook', 'Page', 'Main', '', ''),
    );

    const result = await importer.preview(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const preview = result.value;
    expect(preview).toMatchObject({ totalRows: 8, validRows: 3, invalidRows: 3, duplicateRows: 2 });
    expect(
      preview.rows.map((entry) => [
        entry.line,
        entry.status,
        entry.errorCodes,
        entry.duplicateReason,
      ]),
    ).toEqual([
      [2, 'valid', [], null],
      [3, 'duplicate', [], 'in_file'],
      [4, 'valid', [], null],
      [5, 'duplicate', [], 'existing'],
      [6, 'invalid', ['PLATFORM_UNKNOWN'], null],
      [7, 'valid', [], null],
      // "Twitter" coincide por nombre con dos plataformas: ambiguo (el slug propio sí es único).
      [8, 'invalid', ['PLATFORM_AMBIGUOUS'], null],
      [10, 'invalid', ['USERNAME_REQUIRED', 'PASSWORD_REQUIRED'], null],
    ]);
  });

  it('never echoes usernames or passwords, and writes nothing', async () => {
    const harness = setup();

    const result = await harness.importer.preview(csvOf(row('instagram', 'Brand', 'Main')));

    expect(JSON.stringify(result)).not.toContain(USERNAME_CANARY);
    expect(JSON.stringify(result)).not.toContain(PASSWORD_CANARY);
    expect(harness.log).toEqual(['listPlatforms']);
    expect(harness.encryptedPlaintexts).toEqual([]);
    expect(harness.auditEvents).toEqual([]);
  });

  it('does not attribute cells of a malformed row to columns', async () => {
    const { importer } = setup();

    const result = await importer.preview(`${HEADER}\ninstagram,Brand,Main,${USERNAME_CANARY}`);

    expect(result.ok && result.value.rows[0]).toEqual({
      line: 2,
      status: 'invalid',
      errorCodes: ['COLUMN_COUNT_MISMATCH'],
      duplicateReason: null,
      platform: '',
      accountName: '',
      credentialLabel: '',
    });
  });

  it('truncates long echoed values', async () => {
    const { importer } = setup();

    const result = await importer.preview(csvOf(row('instagram', 'x'.repeat(5000), 'Main')));

    expect(result.ok && result.value.rows[0]?.accountName).toHaveLength(200);
    expect(result.ok && result.value.rows[0]?.errorCodes).toEqual(['ACCOUNT_NAME_INVALID']);
  });

  it('returns file-level errors as domain errors with stable codes', async () => {
    const { importer } = setup();

    const result = await importer.preview('platform,account_name\nx,y');

    expect(!result.ok && result.error.code).toBe('CREDENTIAL_IMPORT.HEADER_INVALID');
  });
});

describe('ImportCredentials.commit', () => {
  it('creates one account per distinct account and a credential per row, all encrypted', async () => {
    const harness = setup();

    const outcome = await harness.importer.commit(
      csvOf(
        row('instagram', 'Brand', 'Main', 'u1', 'p1'),
        row('instagram', 'Brand', 'Backup', 'u2', 'p2'),
        row('facebook', 'Page', 'Main', 'u3', 'p3'),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(imported(outcome.value)).toEqual({
      accountsCreated: 2,
      credentialsCreated: 3,
      duplicatesSkipped: 0,
    });
    expect(harness.insertedAccounts.map((account) => account.displayName)).toEqual([
      'Brand',
      'Page',
    ]);
    expect(harness.insertedCredentials.map((credential) => credential.label)).toEqual([
      'Main',
      'Backup',
      'Main',
    ]);
    // BO-4: quien importa recibe MANAGE sobre cada cuenta nueva.
    expect(harness.insertedShares).toHaveLength(2);
    expect(harness.insertedShares.every((share) => share.level === 'MANAGE')).toBe(true);
    expect(harness.insertedShares.every((share) => share.userId === ACTOR_ID)).toBe(true);
    // El texto en claro solo se entrega al cifrador; lo guardado es el texto cifrado.
    expect(harness.encryptedPlaintexts.sort()).toEqual(['p1', 'p2', 'p3', 'u1', 'u2', 'u3']);
    expect(harness.storedSecrets).toHaveLength(6);
    for (const secret of harness.storedSecrets) {
      expect(new TextDecoder().decode(secret.ciphertext)).toBe('sealed');
    }
  });

  it('audits one event with counts only, as the last write of the transaction', async () => {
    const harness = setup();

    await harness.importer.commit(
      csvOf(row('instagram', 'Brand', 'Main'), row('instagram', 'Brand', 'Main')),
    );

    expect(harness.auditEvents).toHaveLength(1);
    expect(harness.auditEvents[0]).toMatchObject({
      action: 'credential.imported',
      actorId: ACTOR_ID,
      outcome: 'success',
      requestId: 'request-1',
      metadata: { accountsCreated: 1, credentialsCreated: 1, duplicatesSkipped: 1 },
    });
    expect(harness.log.at(-1)).toBe('audit:credential.imported');
    expect(JSON.stringify(harness.auditEvents)).not.toContain(PASSWORD_CANARY);
    expect(JSON.stringify(harness.auditEvents)).not.toContain(USERNAME_CANARY);
    expect(JSON.stringify(harness.auditEvents)).not.toContain('Brand');
  });

  it('skips duplicates of accounts that already exist', async () => {
    const harness = setup({
      existingAccounts: [{ platformId: INSTAGRAM.id, displayName: 'brand' }],
    });

    const outcome = await harness.importer.commit(
      csvOf(row('instagram', 'Brand', 'Main'), row('facebook', 'Page', 'Main')),
    );

    expect(outcome.ok && imported(outcome.value)).toEqual({
      accountsCreated: 1,
      credentialsCreated: 1,
      duplicatesSkipped: 1,
    });
    expect(harness.insertedAccounts.map((account) => account.displayName)).toEqual(['Page']);
  });

  it('is all-or-nothing: one invalid row rejects the file and writes nothing', async () => {
    const harness = setup();

    const outcome = await harness.importer.commit(
      csvOf(row('instagram', 'Brand', 'Main'), row('nowhere', 'Brand', 'Main')),
    );

    expect(outcome.ok && outcome.value.status).toBe('rejected');
    if (outcome.ok && outcome.value.status === 'rejected') {
      expect(outcome.value.preview.rows[1]?.errorCodes).toEqual(['PLATFORM_UNKNOWN']);
      expect(JSON.stringify(outcome.value)).not.toContain(PASSWORD_CANARY);
    }
    expect(harness.insertedAccounts).toEqual([]);
    expect(harness.insertedCredentials).toEqual([]);
    expect(harness.encryptedPlaintexts).toEqual([]);
    expect(harness.auditEvents).toEqual([]);
  });

  it('writes no audit event when encryption fails (the failure aborts the transaction)', async () => {
    const harness = setup({ cipherFails: true });

    await expect(
      harness.importer.commit(csvOf(row('instagram', 'Brand', 'Main'))),
    ).rejects.toMatchObject({ code: 'CRYPTO.KMS_UNAVAILABLE' });

    expect(harness.auditEvents).toEqual([]);
  });

  it('commits an import where every row is a duplicate as a no-op that is still audited', async () => {
    const harness = setup({
      existingAccounts: [{ platformId: INSTAGRAM.id, displayName: 'Brand' }],
    });

    const outcome = await harness.importer.commit(csvOf(row('instagram', 'Brand', 'Main')));

    expect(outcome.ok && imported(outcome.value)).toEqual({
      accountsCreated: 0,
      credentialsCreated: 0,
      duplicatesSkipped: 1,
    });
    expect(harness.insertedAccounts).toEqual([]);
    expect(harness.auditEvents[0]?.metadata).toMatchObject({ accountsCreated: 0 });
  });
});

describe('ImportCredentials authorization matrix', () => {
  const validCsv = csvOf(row('instagram', 'Brand', 'Main'));

  const cases: readonly { name: string; permissions: readonly Permission[] }[] = [
    { name: 'no permissions', permissions: [] },
    { name: 'only account.create', permissions: ['account.create'] },
    { name: 'only credential.create', permissions: ['credential.create'] },
    {
      name: 'only inventory and update permissions',
      permissions: ['vault.inventory.read', 'account.update'],
    },
  ];

  for (const { name, permissions } of cases) {
    for (const action of ['preview', 'commit'] as const) {
      it(`denies ${action} with ${name}, audits the denial and reads nothing`, async () => {
        const harness = setup({ permissions });

        await expect(harness.importer[action](validCsv)).rejects.toMatchObject({
          code: 'AUTHZ.PERMISSION',
        });

        expect(harness.auditEvents).toHaveLength(1);
        expect(harness.auditEvents[0]).toMatchObject({
          action: 'authz.denied',
          actorId: ACTOR_ID,
          outcome: 'denied',
          reasonCode: 'AUTHZ.PERMISSION',
        });
        // Negado: el contenido del archivo ni se lee ni se procesa.
        expect(harness.log).toEqual(['audit:authz.denied']);
        expect(harness.insertedAccounts).toEqual([]);
        expect(harness.encryptedPlaintexts).toEqual([]);
      });
    }
  }

  it('denies a request without an authenticated actor and audits the denial', async () => {
    const harness = setup({ actorId: null });

    await expect(harness.importer.commit(validCsv)).rejects.toMatchObject({
      code: 'AUTHZ.SESSION',
    });

    expect(harness.auditEvents[0]).toMatchObject({ action: 'authz.denied', outcome: 'denied' });
    expect(harness.insertedAccounts).toEqual([]);
  });

  it('allows an actor holding both account.create and credential.create', async () => {
    const harness = setup({ permissions: ['account.create', 'credential.create'] });

    const outcome = await harness.importer.commit(validCsv);

    expect(outcome.ok && outcome.value.status).toBe('imported');
  });
});
