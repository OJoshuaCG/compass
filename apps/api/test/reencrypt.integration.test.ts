import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import { PgCredentialRepository, ReencryptTotpSecrets } from '../src/modules/identity/index.js';
import { PgOrganizationLister, ReencryptSecrets } from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId, asUserId } from '../src/shared/kernel/index.js';
import type { OrganizationId, UserId } from '../src/shared/kernel/index.js';
import { totpSecretContext } from '../src/modules/identity/domain/totp-secret-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

let db: TestDatabase;
let kekDir: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let keys: DataKeyResolver;
let cipher: SecretCipher;
let credentials: PgCredentialRepository;
let reencryptor: ReencryptTotpSecrets;
let job: ReencryptSecrets;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  kekDir = mkdtempSync(join(tmpdir(), 'iam-kek-'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  const clock = new SystemClock();
  keys = new DataKeyResolver({
    repository: new PgDataKeyRepository(uow),
    kms: new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' }),
    cache: new DekCache({ clock }),
    clock,
    independently: (fn) => uow.runIndependent(fn),
  });
  cipher = new SecretCipher({ keys, primitives: new NodeCryptoPrimitives() });
  credentials = new PgCredentialRepository(uow);
  reencryptor = new ReencryptTotpSecrets({ credentials, cipher });
  job = new ReencryptSecrets({
    organizations: new PgOrganizationLister(db.appPool),
    reencryptors: [reencryptor],
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock,
  });
});

afterAll(async () => {
  await db.close();
  rmSync(kekDir, { recursive: true, force: true });
});

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

/** El primer usuario de la organización es la Raíz; los siguientes son Operadores a su cargo. */
async function seedUser(organizationId: string, email: string): Promise<UserId> {
  const root = await db.admin.query<{ id: string }>(
    'select id from users where organization_id = $1 and rank = 0 limit 1',
    [organizationId],
  );
  const rootId = root.rows[0]?.id ?? null;
  const result = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, managed_by) values ($1, $2, 'Seed', $3, $4) returning id",
    [organizationId, email, rootId === null ? 0 : 3, rootId],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return asUserId(id);
}

/** Guarda un secreto TOTP cifrado con la DEK activa en ese momento. */
async function enroll(org: OrganizationId, userId: UserId, secret: string): Promise<void> {
  await inOrg(org, async () => {
    const sealed = await cipher.encrypt(totpSecretContext(org, userId), text(secret));
    if (!sealed.ok) throw new Error(sealed.error.code);
    await credentials.saveUnverifiedTotpFactor({ userId, ...sealed.value });
  });
}

async function versionsOf(org: OrganizationId): Promise<number[]> {
  const rows = await db.admin.query<{ dek_version: number }>(
    'select dek_version from user_totp_factors where organization_id = $1 order by dek_version',
    [org],
  );
  return rows.rows.map((row) => row.dek_version);
}

async function openActiveSecret(org: OrganizationId, userId: UserId): Promise<string> {
  return inOrg(org, async () => {
    const factor = await credentials.findTotpFactor(userId);
    if (factor === null) throw new Error('no factor');
    const opened = await cipher.decrypt(totpSecretContext(org, userId), {
      ciphertext: factor.ciphertext,
      nonce: factor.nonce,
      dekVersion: factor.dekVersion,
    });
    if (!opened.ok) throw new Error(opened.error.code);
    return read(opened.value);
  });
}

describe('DEK re-encryption (ADR 0040)', () => {
  let rotated: OrganizationId;
  let untouched: OrganizationId;
  let ana: UserId;
  let beto: UserId;
  let carla: UserId;
  let otherOrgUser: UserId;

  beforeAll(async () => {
    rotated = asOrganizationId(await db.seedOrganization('reenc-rotated'));
    untouched = asOrganizationId(await db.seedOrganization('reenc-untouched'));
    ana = await seedUser(rotated, 'ana@reenc.test');
    beto = await seedUser(rotated, 'beto@reenc.test');
    carla = await seedUser(rotated, 'carla@reenc.test');
    otherOrgUser = await seedUser(untouched, 'otro@reenc.test');

    await enroll(rotated, ana, 'ANA-SECRET');
    await enroll(rotated, beto, 'BETO-SECRET');
    // Carla se registra dos veces: el primer factor queda revocado pero sigue cifrado con la DEK vieja.
    await enroll(rotated, carla, 'CARLA-OLD');
    await enroll(rotated, carla, 'CARLA-SECRET');
    await enroll(untouched, otherOrgUser, 'OTHER-SECRET');
  });

  it('leaves everything on version 1 before any rotation', async () => {
    expect(await versionsOf(rotated)).toEqual([1, 1, 1, 1]);
    const pending = await inOrg(rotated, () => reencryptor.countPending(rotated));
    expect(pending).toBe(0);
  });

  it('keeps old and new ciphertexts readable while they coexist, and recrypts in resumable batches', async () => {
    const newVersion = await inOrg(rotated, () => keys.rotate(rotated));
    expect(newVersion).toBe(2);

    // Un secreto nuevo se cifra ya con la versión 2: conviven ambas.
    const dario = await seedUser(rotated, 'dario@reenc.test');
    await enroll(rotated, dario, 'DARIO-SECRET');
    expect(await versionsOf(rotated)).toEqual([1, 1, 1, 1, 2]);
    expect(await openActiveSecret(rotated, ana)).toBe('ANA-SECRET');
    expect(await openActiveSecret(rotated, dario)).toBe('DARIO-SECRET');

    // "Interrupción": solo un lote de una fila y se detiene.
    const partial = await inOrg(rotated, () => reencryptor.reencryptBatch(rotated, 1, null));
    expect(partial).toMatchObject({ resealed: 1, conflicts: 0, failed: 0, examined: 1 });
    expect(await versionsOf(rotated)).toEqual([1, 1, 1, 2, 2]);
    expect(await openActiveSecret(rotated, ana)).toBe('ANA-SECRET');
    expect(await openActiveSecret(rotated, beto)).toBe('BETO-SECRET');
    expect(await openActiveSecret(rotated, carla)).toBe('CARLA-SECRET');

    // Reanudación: el pase completo termina lo que faltaba, sin punto de control propio.
    const summary = await job.execute();
    const report = summary.reports.find((r) => r.organizationId === rotated);
    expect(report).toMatchObject({ resealed: 3, conflicts: 0, failed: 0, pending: 0 });
    expect(summary.failedOrganizations).toEqual([]);
    expect(await versionsOf(rotated)).toEqual([2, 2, 2, 2, 2]);
    expect(await openActiveSecret(rotated, ana)).toBe('ANA-SECRET');
    expect(await openActiveSecret(rotated, carla)).toBe('CARLA-SECRET');
  });

  it('is idempotent: a second pass changes nothing', async () => {
    const before = await db.admin.query<{ id: string; nonce: Buffer }>(
      'select id, nonce from user_totp_factors where organization_id = $1 order by id',
      [rotated],
    );
    const summary = await job.execute();
    expect(summary.resealed).toBe(0);
    expect(summary.pending).toBe(0);
    const after = await db.admin.query<{ id: string; nonce: Buffer }>(
      'select id, nonce from user_totp_factors where organization_id = $1 order by id',
      [rotated],
    );
    expect(after.rows.map((r) => r.nonce.toString('hex'))).toEqual(
      before.rows.map((r) => r.nonce.toString('hex')),
    );
  });

  it('never touches an organization that did not rotate', async () => {
    expect(await versionsOf(untouched)).toEqual([1]);
    expect(await openActiveSecret(untouched, otherOrgUser)).toBe('OTHER-SECRET');
  });

  it('skips a row that another write changed after it was read (compare-and-set)', async () => {
    const stale = await inOrg(rotated, async () => {
      const factor = await credentials.findTotpFactor(ana);
      if (factor === null) throw new Error('no factor');
      // La fila ya está en la versión 2; quien creía leerla en la 1 no debe poder pisarla.
      return credentials.replaceTotpSecret({
        factorId: factor.id,
        expectedDekVersion: 1,
        ciphertext: factor.ciphertext,
        nonce: factor.nonce,
        dekVersion: 2,
      });
    });
    expect(stale).toBe(false);
    expect(await openActiveSecret(rotated, ana)).toBe('ANA-SECRET');
  });

  it('counts a secret it cannot open as failed and leaves it pending instead of corrupting it', async () => {
    const broken = asOrganizationId(await db.seedOrganization('reenc-broken'));
    const edgar = await seedUser(broken, 'edgar@reenc.test');
    await enroll(broken, edgar, 'EDGAR-SECRET');
    await inOrg(broken, () => keys.rotate(broken));
    // Un texto cifrado alterado (por ejemplo, restaurado de un respaldo dañado).
    await db.admin.query(
      "update user_totp_factors set secret_ciphertext = decode(repeat('00', 40), 'hex') where organization_id = $1",
      [broken],
    );

    const summary = await job.execute();
    const report = summary.reports.find((r) => r.organizationId === broken);
    expect(report).toMatchObject({ resealed: 0, failed: 1, pending: 1 });
    expect(await versionsOf(broken)).toEqual([1]);
  });

  it('keeps going past unreadable rows instead of stalling on them (cursor)', async () => {
    const poisoned = asOrganizationId(await db.seedOrganization('reenc-poisoned'));
    const first = await seedUser(poisoned, 'primero@reenc.test');
    const second = await seedUser(poisoned, 'segundo@reenc.test');
    await enroll(poisoned, first, 'FIRST-SECRET');
    await enroll(poisoned, second, 'SECOND-SECRET');
    await inOrg(poisoned, () => keys.rotate(poisoned));
    // La fila de menor id queda ilegible: con un lote de 1 siempre sería la primera en elegirse.
    await db.admin.query(
      "update user_totp_factors set secret_ciphertext = decode(repeat('00', 40), 'hex') where id = (select id from user_totp_factors where organization_id = $1 order by id limit 1)",
      [poisoned],
    );

    const firstBatch = await inOrg(poisoned, () => reencryptor.reencryptBatch(poisoned, 1, null));
    expect(firstBatch).toMatchObject({ resealed: 0, failed: 1, examined: 1 });
    expect(firstBatch.lastId).not.toBeNull();

    const secondBatch = await inOrg(poisoned, () =>
      reencryptor.reencryptBatch(poisoned, 1, firstBatch.lastId),
    );
    expect(secondBatch).toMatchObject({ resealed: 1, failed: 0, examined: 1 });
    expect(await versionsOf(poisoned)).toEqual([1, 2]);
  });
});
