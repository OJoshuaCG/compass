import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgAlertSettingsStore } from '../src/modules/integrations/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Almacén de preferencias de alerta con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿sin fila rige el
 * valor por omisión, la versión detecta escrituras simultáneas y nada cruza de organización?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let store: PgAlertSettingsStore;
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
  store = new PgAlertSettingsStore(uow);
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

describe('PgAlertSettingsStore', () => {
  it('devuelve correo y Telegram encendidos con versión 0 cuando no hay fila', async () => {
    const fixture = await seedFixture('alerts-default');

    const found = await inOrg(fixture.organization, () => store.find());

    expect(found).toEqual({
      infrastructure: { email: true, telegram: true },
      updatedBy: null,
      updatedAt: null,
      version: 0,
    });
  });

  it('crea la fila en versión 1 y la sube en cada cambio', async () => {
    const fixture = await seedFixture('alerts-save');

    const created = await inOrg(fixture.organization, () =>
      store.save({
        infrastructure: { email: true, telegram: false },
        updatedBy: fixture.root,
        expectedVersion: 0,
      }),
    );
    expect(created).toMatchObject({
      infrastructure: { email: true, telegram: false },
      updatedBy: fixture.root,
      version: 1,
    });

    const updated = await inOrg(fixture.organization, () =>
      store.save({
        infrastructure: { email: false, telegram: true },
        updatedBy: fixture.root,
        expectedVersion: 1,
      }),
    );
    expect(updated).toMatchObject({ infrastructure: { email: false, telegram: true }, version: 2 });
    expect(await inOrg(fixture.organization, () => store.find())).toMatchObject({ version: 2 });
  });

  it('devuelve null con una versión vieja, también si otra persona creó la fila primero', async () => {
    const fixture = await seedFixture('alerts-conflict');
    const first = {
      infrastructure: { email: true, telegram: true },
      updatedBy: fixture.root,
      expectedVersion: 0,
    };
    await inOrg(fixture.organization, () => store.save(first));

    expect(await inOrg(fixture.organization, () => store.save(first))).toBeNull();
    expect(
      await inOrg(fixture.organization, () => store.save({ ...first, expectedVersion: 7 })),
    ).toBeNull();
    expect(await inOrg(fixture.organization, () => store.find())).toMatchObject({ version: 1 });
  });

  it('no deja ver ni cambiar el ajuste de otra organización', async () => {
    const owner = await seedFixture('alerts-owner');
    const other = await seedFixture('alerts-other');
    await inOrg(owner.organization, () =>
      store.save({
        infrastructure: { email: true, telegram: false },
        updatedBy: owner.root,
        expectedVersion: 0,
      }),
    );

    expect(await inOrg(other.organization, () => store.find())).toMatchObject({ version: 0 });
    expect(
      await inOrg(other.organization, () =>
        store.save({
          infrastructure: { email: false, telegram: true },
          updatedBy: other.root,
          expectedVersion: 1,
        }),
      ),
    ).toBeNull();
    expect(await inOrg(owner.organization, () => store.find())).toMatchObject({
      infrastructure: { email: true, telegram: false },
      version: 1,
    });
  });
});
