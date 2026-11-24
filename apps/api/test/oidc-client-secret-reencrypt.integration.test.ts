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
import {
  PgOidcClientSecretStore,
  PgOidcClientStore,
  ReencryptOidcClientSecrets,
} from '../src/modules/federation/index.js';
import {
  clientSecretContext,
  packClientSecret,
  unpackClientSecret,
} from '../src/modules/federation/domain/client-secret.js';
import { PgOrganizationLister, ReencryptSecrets } from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import type { OrganizationId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Recifrado de los secretos de clientes OIDC al rotar la DEK (ADR 0040), con el rol de la aplicación y
 * contra PostgreSQL real: ¿el secreto sigue abriéndose con su contexto, las organizaciones no se mezclan y
 * un valor corrupto queda pendiente en lugar de dañarse o frenar el recorrido?
 */

let db: TestDatabase;
let kekDir: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let keys: DataKeyResolver;
let cipher: SecretCipher;
let clients: PgOidcClientStore;
let reencryptor: ReencryptOidcClientSecrets;
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
  clients = new PgOidcClientStore(uow);
  reencryptor = new ReencryptOidcClientSecrets({ store: new PgOidcClientSecretStore(uow), cipher });
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

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

async function seedOrganizationWithRoot(
  slug: string,
): Promise<{ organization: OrganizationId; root: string }> {
  const organization = await db.seedOrganization(slug);
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const root = result.rows[0]?.id;
  if (root === undefined) throw new Error('seed failed');
  return { organization: asOrganizationId(organization), root };
}

/** Registra un cliente con su secreto cifrado con la DEK activa en ese momento; devuelve el id de la fila. */
async function registerClient(
  organization: OrganizationId,
  root: string,
  secret: string,
  status: 'active' | 'disabled' = 'active',
): Promise<string> {
  const id = crypto.randomUUID();
  await inOrg(organization, async () => {
    const sealed = await cipher.encrypt(
      clientSecretContext(organization, id),
      new TextEncoder().encode(secret),
    );
    if (!sealed.ok) throw new Error(sealed.error.code);
    await clients.insert({
      id,
      clientId: `cmp_${crypto.randomUUID().replaceAll('-', '')}`,
      name: 'Grafana',
      secretCiphertext: packClientSecret(sealed.value),
      redirectUris: ['https://grafana.example.test/login/generic_oauth'],
      postLogoutRedirectUris: [],
      backchannelLogoutUri: null,
      allowPrivateNetworkBackchannel: false,
      allowRefreshTokens: false,
      refreshJustification: null,
      isExternal: false,
      maxRank: null,
      createdBy: root,
    });
  });
  if (status === 'disabled') {
    await db.admin.query(
      "update oidc_clients set status = 'disabled', disabled_at = now() where id = $1",
      [id],
    );
  }
  return id;
}

async function dekVersionOf(clientRowId: string): Promise<number> {
  const result = await db.admin.query<{ version: number }>(
    `select get_byte(secret_ciphertext, 3) as version from oidc_clients where id = $1`,
    [clientRowId],
  );
  const version = result.rows[0]?.version;
  if (version === undefined) throw new Error('client not found');
  return version;
}

/** Abre el secreto guardado como lo hace el adaptador: desempaqueta y descifra con el contexto de la fila. */
async function openStoredSecret(
  organization: OrganizationId,
  clientRowId: string,
): Promise<string> {
  const stored = await db.admin.query<{ secret_ciphertext: Buffer }>(
    'select secret_ciphertext from oidc_clients where id = $1',
    [clientRowId],
  );
  const packed = stored.rows[0]?.secret_ciphertext;
  if (packed === undefined) throw new Error('client not found');
  const secret = unpackClientSecret(new Uint8Array(packed));
  if (secret === null) throw new Error('unexpected format');
  return inOrg(organization, async () => {
    const opened = await cipher.decrypt(clientSecretContext(organization, clientRowId), secret);
    if (!opened.ok) throw new Error(opened.error.code);
    return new TextDecoder().decode(opened.value);
  });
}

describe('recifrado de secretos de clientes OIDC (ADR 0040)', () => {
  it('migra a la DEK activa, incluidos los clientes deshabilitados, y el secreto sigue abriéndose', async () => {
    const { organization, root } = await seedOrganizationWithRoot('oidc-reenc-main');
    const activeClient = await registerClient(organization, root, 'ACTIVE-SECRET');
    const disabledClient = await registerClient(organization, root, 'DISABLED-SECRET', 'disabled');
    expect(await inOrg(organization, () => reencryptor.countPending(organization))).toBe(0);

    await inOrg(organization, () => keys.rotate(organization));
    expect(await inOrg(organization, () => reencryptor.countPending(organization))).toBe(2);
    // Mientras conviven las dos versiones el secreto viejo sigue legible.
    expect(await openStoredSecret(organization, activeClient)).toBe('ACTIVE-SECRET');

    const summary = await job.execute();
    const report = summary.reports.find((entry) => entry.organizationId === organization);
    expect(report).toMatchObject({ resealed: 2, conflicts: 0, failed: 0, pending: 0 });
    expect(await dekVersionOf(activeClient)).toBe(2);
    expect(await dekVersionOf(disabledClient)).toBe(2);
    expect(await openStoredSecret(organization, activeClient)).toBe('ACTIVE-SECRET');
    expect(await openStoredSecret(organization, disabledClient)).toBe('DISABLED-SECRET');
  });

  it('es idempotente: un segundo pase no cambia nada', async () => {
    const { organization, root } = await seedOrganizationWithRoot('oidc-reenc-idempotent');
    const clientRowId = await registerClient(organization, root, 'SECRET');
    await inOrg(organization, () => keys.rotate(organization));
    await job.execute();
    const before = await db.admin.query<{ secret_ciphertext: Buffer }>(
      'select secret_ciphertext from oidc_clients where id = $1',
      [clientRowId],
    );

    const summary = await job.execute();

    expect(summary.reports.find((entry) => entry.organizationId === organization)).toMatchObject({
      resealed: 0,
      pending: 0,
    });
    const after = await db.admin.query<{ secret_ciphertext: Buffer }>(
      'select secret_ciphertext from oidc_clients where id = $1',
      [clientRowId],
    );
    expect(after.rows[0]?.secret_ciphertext.toString('hex')).toBe(
      before.rows[0]?.secret_ciphertext.toString('hex'),
    );
  });

  it('no toca a una organización que no rotó', async () => {
    const rotated = await seedOrganizationWithRoot('oidc-reenc-rotated');
    const untouched = await seedOrganizationWithRoot('oidc-reenc-untouched');
    await registerClient(rotated.organization, rotated.root, 'ROTATED');
    const untouchedClient = await registerClient(
      untouched.organization,
      untouched.root,
      'UNTOUCHED',
    );
    await inOrg(rotated.organization, () => keys.rotate(rotated.organization));

    await job.execute();

    expect(await dekVersionOf(untouchedClient)).toBe(1);
    expect(await openStoredSecret(untouched.organization, untouchedClient)).toBe('UNTOUCHED');
  });

  it('un valor que no se puede abrir queda pendiente y no se daña', async () => {
    const { organization, root } = await seedOrganizationWithRoot('oidc-reenc-broken');
    const clientRowId = await registerClient(organization, root, 'BROKEN');
    await inOrg(organization, () => keys.rotate(organization));
    // Cabecera de la versión 1 y el resto alterado (por ejemplo, restaurado de un respaldo dañado).
    await db.admin.query(
      "update oidc_clients set secret_ciphertext = decode('00000001' || repeat('00', 40), 'hex') where id = $1",
      [clientRowId],
    );

    const summary = await job.execute();

    expect(summary.reports.find((entry) => entry.organizationId === organization)).toMatchObject({
      resealed: 0,
      failed: 1,
      pending: 1,
    });
    expect(await dekVersionOf(clientRowId)).toBe(1);
  });

  it('sigue adelante aunque la primera fila sea ilegible (cursor)', async () => {
    const { organization, root } = await seedOrganizationWithRoot('oidc-reenc-poisoned');
    await registerClient(organization, root, 'FIRST');
    await registerClient(organization, root, 'SECOND');
    await inOrg(organization, () => keys.rotate(organization));
    await db.admin.query(
      `update oidc_clients set secret_ciphertext = decode('00000001' || repeat('00', 40), 'hex')
        where id = (select id from oidc_clients where organization_id = $1 order by id limit 1)`,
      [organization],
    );

    const firstBatch = await inOrg(organization, () =>
      reencryptor.reencryptBatch(organization, 1, null),
    );
    expect(firstBatch).toMatchObject({ resealed: 0, failed: 1, examined: 1 });
    expect(firstBatch.lastId).not.toBeNull();

    const secondBatch = await inOrg(organization, () =>
      reencryptor.reencryptBatch(organization, 1, firstBatch.lastId),
    );
    expect(secondBatch).toMatchObject({ resealed: 1, failed: 0, examined: 1 });
  });
});
