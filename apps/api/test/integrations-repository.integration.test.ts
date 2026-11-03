import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgIntegrationRepository } from '../src/modules/integrations/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Repositorio de integraciones con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿el chat y el
 * secreto se guardan donde toca, el secreto nunca aparece en las lecturas y nada cruza de organización?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let repository: PgIntegrationRepository;
const requestContext = new AsyncLocalRequestContext();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
}

// La base exige al menos 16 bytes de cifrado (texto más etiqueta) y un nonce de 12.
const CIPHERTEXT_A = new Uint8Array(16).fill(1);
const NONCE_A = new Uint8Array(12).fill(2);
const CIPHERTEXT_B = new Uint8Array(24).fill(9);
const NONCE_B = new Uint8Array(12).fill(8);
const CHAT_ID = '-1001234567890';

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  repository = new PgIntegrationRepository(uow);
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
  // La FK de `dek_version` exige que la clave de datos exista; el contenido envuelto no se usa aquí.
  await db.admin.query(
    "insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref, status) values ($1, 1, '\\x0102', 'local/test', 'active')",
    [organization],
  );
  return { organization, root };
}

describe('PgIntegrationRepository', () => {
  it('inserta una integración sin token y guarda el chat en la configuración', async () => {
    const fixture = await seedFixture('integ-insert');
    const created = await inOrg(fixture.organization, () =>
      repository.insert({
        kind: 'telegram_infra',
        name: 'Alertas',
        chatId: CHAT_ID,
        createdBy: asUserId(fixture.root),
      }),
    );
    expect(created).toMatchObject({
      kind: 'telegram_infra',
      name: 'Alertas',
      status: 'active',
      chatId: CHAT_ID,
      hasBotToken: false,
    });
  });

  it('guarda y reemplaza el secreto, y las lecturas solo informan que existe', async () => {
    const fixture = await seedFixture('integ-secret');
    const created = await inOrg(fixture.organization, () =>
      repository.insert({
        kind: 'telegram_security',
        name: 'Seguridad',
        chatId: CHAT_ID,
        createdBy: asUserId(fixture.root),
      }),
    );
    await inOrg(fixture.organization, () =>
      repository.putSecret({
        integrationId: created.id,
        field: 'bot_token',
        secretVersion: 1,
        encrypted: { ciphertext: CIPHERTEXT_A, nonce: NONCE_A, dekVersion: 1 },
        rotatedAt: new Date('2026-11-03T10:00:00Z'),
      }),
    );
    await inOrg(fixture.organization, () =>
      repository.putSecret({
        integrationId: created.id,
        field: 'bot_token',
        secretVersion: 2,
        encrypted: { ciphertext: CIPHERTEXT_B, nonce: NONCE_B, dekVersion: 1 },
        rotatedAt: new Date('2026-11-03T11:00:00Z'),
      }),
    );

    const stored = await inOrg(fixture.organization, () =>
      repository.findSecret(created.id, 'bot_token'),
    );
    expect(stored?.secretVersion).toBe(2);
    expect(Array.from(stored?.encrypted.ciphertext ?? [])).toEqual(Array.from(CIPHERTEXT_B));

    const listed = await inOrg(fixture.organization, () =>
      repository.listByKinds(['telegram_security']),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]?.hasBotToken).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('ciphertext');
  });

  it('actualiza nombre y chat, y archiva sin borrar el secreto', async () => {
    const fixture = await seedFixture('integ-archive');
    const created = await inOrg(fixture.organization, () =>
      repository.insert({
        kind: 'telegram_infra',
        name: 'Alertas',
        chatId: CHAT_ID,
        createdBy: asUserId(fixture.root),
      }),
    );
    await inOrg(fixture.organization, () =>
      repository.putSecret({
        integrationId: created.id,
        field: 'bot_token',
        secretVersion: 1,
        encrypted: { ciphertext: CIPHERTEXT_A, nonce: NONCE_A, dekVersion: 1 },
        rotatedAt: new Date('2026-11-03T10:00:00Z'),
      }),
    );

    const updated = await inOrg(fixture.organization, () =>
      repository.update(created.id, { name: 'Alertas de infraestructura', chatId: '42' }),
    );
    expect(updated).toMatchObject({ name: 'Alertas de infraestructura', chatId: '42' });

    const archived = await inOrg(fixture.organization, () =>
      repository.archive(created.id, new Date('2026-11-03T12:00:00Z')),
    );
    expect(archived.status).toBe('archived');
    expect(archived.hasBotToken).toBe(true);

    const active = await inOrg(fixture.organization, () =>
      repository.findActiveByKind('telegram_infra'),
    );
    expect(active).toBeNull();
  });

  it('no deja dos canales activos del mismo tipo en una organización', async () => {
    const fixture = await seedFixture('integ-unique');
    const insertOne = (): Promise<unknown> =>
      inOrg(fixture.organization, () =>
        repository.insert({
          kind: 'telegram_infra',
          name: 'Alertas',
          chatId: CHAT_ID,
          createdBy: asUserId(fixture.root),
        }),
      );
    await insertOne();
    await expect(insertOne()).rejects.toThrow();
  });

  it('aísla las integraciones por organización', async () => {
    const first = await seedFixture('integ-iso-a');
    const second = await seedFixture('integ-iso-b');
    const created = await inOrg(first.organization, () =>
      repository.insert({
        kind: 'telegram_infra',
        name: 'Alertas',
        chatId: CHAT_ID,
        createdBy: asUserId(first.root),
      }),
    );

    const fromOther = await inOrg(second.organization, () => repository.findForUpdate(created.id));
    expect(fromOther).toBeNull();
    const listedByOther = await inOrg(second.organization, () =>
      repository.listByKinds(['telegram_infra', 'telegram_security']),
    );
    expect(listedByOther).toHaveLength(0);
  });
});
