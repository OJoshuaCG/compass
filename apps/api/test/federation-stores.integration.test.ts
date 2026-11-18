import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgGrantStore, PgOidcClientStore } from '../src/modules/federation/index.js';
import type { NewOidcClient } from '../src/modules/federation/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Almacenes de la federación con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿un cliente o una
 * concesión de otra organización nunca se lee ni se borra, y el secreto cifrado nunca sale en los listados?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let clients: PgOidcClientStore;
let grants: PgGrantStore;
const requestContext = new AsyncLocalRequestContext();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  clients = new PgOidcClientStore(uow);
  grants = new PgGrantStore(uow);
});

afterAll(async () => {
  await db.close();
});

async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const root = result.rows[0]?.id;
  if (root === undefined) throw new Error('seed failed');
  return { organization, root };
}

/** 32 bytes aleatorios: el tamaño de un SHA-256, que exigen `token_hash` y `key_hash`. */
const randomHash = (): Buffer =>
  Buffer.from(
    crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    'hex',
  );

const newClient = (fixture: Fixture, overrides: Partial<NewOidcClient> = {}): NewOidcClient => ({
  id: crypto.randomUUID(),
  clientId: `cmp_${crypto.randomUUID().replaceAll('-', '')}`,
  name: 'Grafana',
  secretCiphertext: new Uint8Array([1, 2, 3, 4]),
  redirectUris: ['https://grafana.example.test/login/generic_oauth'],
  postLogoutRedirectUris: [],
  backchannelLogoutUri: null,
  allowPrivateNetworkBackchannel: false,
  allowRefreshTokens: false,
  refreshJustification: null,
  isExternal: false,
  maxRank: null,
  createdBy: fixture.root,
  ...overrides,
});

describe('PgOidcClientStore', () => {
  it('inserta, lista sin exponer el secreto y aísla por organización', async () => {
    const a = await seedFixture('fed-clients-a');
    const b = await seedFixture('fed-clients-b');
    const client = newClient(a, { maxRank: 1 });

    const created = await inOrg(a.organization, () => clients.insert(client));
    expect(created).toMatchObject({ clientId: client.clientId, maxRank: 1, status: 'active' });
    expect(created).not.toHaveProperty('secretCiphertext');

    const listedA = await inOrg(a.organization, () => clients.list());
    expect(listedA.map((row) => row.clientId)).toEqual([client.clientId]);
    expect(JSON.stringify(listedA)).not.toContain('secret');
    expect(await inOrg(b.organization, () => clients.list())).toEqual([]);
    expect(await inOrg(b.organization, () => clients.findForUpdate(client.id))).toBeNull();
  });

  it('devuelve null con un client_id repetido sin abortar la transacción', async () => {
    const a = await seedFixture('fed-clients-dup');
    const first = newClient(a);
    await inOrg(a.organization, () => clients.insert(first));

    const duplicate = await inOrg(a.organization, async () => {
      const result = await clients.insert(newClient(a, { clientId: first.clientId }));
      const stillUsable = await clients.list();
      return { result, count: stillUsable.length };
    });

    expect(duplicate).toEqual({ result: null, count: 1 });
  });

  it('deshabilita un cliente y no deja a otra organización tocarlo', async () => {
    const a = await seedFixture('fed-clients-disable-a');
    const b = await seedFixture('fed-clients-disable-b');
    const client = newClient(a);
    await inOrg(a.organization, () => clients.insert(client));

    const disabled = await inOrg(a.organization, () => clients.disable(client.id, new Date()));
    expect(disabled.status).toBe('disabled');

    await expect(
      inOrg(b.organization, () => clients.disable(client.id, new Date())),
    ).rejects.toThrow();
    await inOrg(b.organization, () => clients.replaceSecret(client.id, new Uint8Array([9])));
    const stored = await db.admin.query<{ secret_ciphertext: Buffer }>(
      `select secret_ciphertext from oidc_clients where id = $1`,
      [client.id],
    );
    expect([...(stored.rows[0]?.secret_ciphertext ?? [])]).toEqual([1, 2, 3, 4]);
  });
});

describe('PgGrantStore', () => {
  async function seedSession(fixture: Fixture): Promise<string> {
    const result = await db.admin.query<{ id: string }>(
      `insert into sessions (organization_id, user_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '1 hour') returning id`,
      [fixture.organization, fixture.root, randomHash()],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('session seed failed');
    return id;
  }

  async function seedPayload(fixture: Fixture, sessionId: string | null): Promise<void> {
    await db.admin.query(
      `insert into oidc_payloads (organization_id, model, key_hash, payload, user_id, compass_session_id, expires_at)
       values ($1, 'Grant', $2, '{}'::jsonb, $3, $4, now() + interval '1 hour')`,
      [fixture.organization, randomHash(), fixture.root, sessionId],
    );
  }

  const countPayloads = async (organization: string): Promise<number> => {
    const result = await db.admin.query<{ n: string }>(
      `select count(*) as n from oidc_payloads where organization_id = $1`,
      [organization],
    );
    return Number(result.rows[0]?.n ?? 0);
  };

  it('borra por sesión solo las filas de esa sesión y organización', async () => {
    const a = await seedFixture('fed-grants-a');
    const b = await seedFixture('fed-grants-b');
    const sessionA1 = await seedSession(a);
    const sessionA2 = await seedSession(a);
    const sessionB = await seedSession(b);
    await seedPayload(a, sessionA1);
    await seedPayload(a, sessionA2);
    await seedPayload(b, sessionB);

    // Pedir la sesión de B desde A no debe borrar nada de B (RLS), y la lista vacía no borra nada.
    expect(await inOrg(a.organization, () => grants.deleteBySessions([sessionB]))).toBe(0);
    expect(await inOrg(a.organization, () => grants.deleteBySessions([]))).toBe(0);
    expect(await inOrg(a.organization, () => grants.deleteBySessions([sessionA1]))).toBe(1);

    expect(await countPayloads(a.organization)).toBe(1);
    expect(await countPayloads(b.organization)).toBe(1);
  });

  it('borra por persona todas sus filas, con o sin sesión viva', async () => {
    const a = await seedFixture('fed-grants-user-a');
    const b = await seedFixture('fed-grants-user-b');
    await seedPayload(a, await seedSession(a));
    await seedPayload(a, null);
    await seedPayload(b, null);

    expect(await inOrg(a.organization, () => grants.deleteByUser(b.root))).toBe(0);
    expect(await inOrg(a.organization, () => grants.deleteByUser(a.root))).toBe(2);

    expect(await countPayloads(a.organization)).toBe(0);
    expect(await countPayloads(b.organization)).toBe(1);
  });
});
