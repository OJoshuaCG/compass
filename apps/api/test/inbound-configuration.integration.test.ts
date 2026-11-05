import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgInboundConfigurationRepository } from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Configuración de fuentes y vistas de correo con el rol de la aplicación (`iam_app`, sin BYPASSRLS):
 * ¿el repositorio escribe solo lo suyo y respeta los candados de unicidad y de archivo?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let repository: PgInboundConfigurationRepository;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const NOW = new Date('2026-11-02T12:00:00Z');
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly member: string;
  readonly slug: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  repository = new PgInboundConfigurationRepository(uow);
});

afterAll(async () => {
  await db.close();
});

async function insertOne(sql: string, values: readonly unknown[]): Promise<string> {
  const result = await db.admin.query<{ id: string }>(sql, [...values]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const root = await insertOne(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const member = await insertOne(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, 'Persona', 2, $3, 'active') returning id`,
    [organization, `persona-${slug}@example.test`, root],
  );
  return { organization, root, member, slug };
}

async function seedTemplate(fixture: Fixture, archived = false): Promise<string> {
  return insertOne(
    `insert into inbound_templates (organization_id, name, kind, definition, created_by, archived_at)
     values ($1, 'Plantilla', 'login_code', '{}'::jsonb, $2, case when $3 then now() else null end)
     returning id`,
    [fixture.organization, fixture.root, archived],
  );
}

async function createSource(fixture: Fixture, address: string): Promise<string> {
  const id = ids.next();
  const outcome = await inOrg(fixture.organization, () =>
    repository.insertSource({
      id,
      address,
      displayName: 'Buzón',
      accountId: null,
      createdBy: asUserId(fixture.root),
    }),
  );
  expect(outcome).toBe('inserted');
  return id;
}

async function createView(fixture: Fixture, sourceId: string, name: string): Promise<string> {
  const id = ids.next();
  const outcome = await inOrg(fixture.organization, () =>
    repository.insertView({ id, sourceId, name, createdBy: asUserId(fixture.root) }),
  );
  expect(outcome).toBe('inserted');
  return id;
}

describe('PgInboundConfigurationRepository: fuentes', () => {
  it('inserta una fuente y una dirección repetida se responde address_taken sin romper la transacción', async () => {
    const fixture = await seedFixture('cfg-source');
    const address = 'codes@cfg-source.example';
    await createSource(fixture, address);

    const duplicate = await inOrg(fixture.organization, async () => {
      const outcome = await repository.insertSource({
        id: ids.next(),
        address,
        displayName: 'Otra',
        accountId: null,
        createdBy: asUserId(fixture.root),
      });
      // La transacción sigue viva tras el duplicado: se puede seguir leyendo.
      const stillUsable = await repository.countLiveTemplates([]);
      return { outcome, stillUsable };
    });

    expect(duplicate).toEqual({ outcome: 'address_taken', stillUsable: 0 });
  });

  it('una dirección de otra organización también se responde address_taken (es única en toda la base)', async () => {
    const first = await seedFixture('cfg-addr-a');
    const second = await seedFixture('cfg-addr-b');
    await createSource(first, 'shared@cfg-addr.example');

    const outcome = await inOrg(second.organization, () =>
      repository.insertSource({
        id: ids.next(),
        address: 'shared@cfg-addr.example',
        displayName: 'Otra org',
        accountId: null,
        createdBy: asUserId(second.root),
      }),
    );

    expect(outcome).toBe('address_taken');
  });

  it('no ve ni bloquea fuentes de otra organización', async () => {
    const mine = await seedFixture('cfg-iso-a');
    const theirs = await seedFixture('cfg-iso-b');
    const theirSource = await createSource(theirs, 'codes@cfg-iso-b.example');

    expect(
      await inOrg(mine.organization, () => repository.findSourceForUpdate(theirSource)),
    ).toBeNull();
    expect(await inOrg(mine.organization, () => repository.findSource(theirSource))).toBeNull();
  });

  it('insertManageShare da MANAGE efectivo a quien crea la fuente', async () => {
    const fixture = await seedFixture('cfg-manage');
    const sourceId = await createSource(fixture, 'codes@cfg-manage.example');

    const level = await inOrg(fixture.organization, async () => {
      await repository.insertManageShare({
        id: ids.next(),
        resourceType: 'mail_source',
        resourceId: sourceId,
        userId: asUserId(fixture.root),
      });
      return repository.resourceLevel('mail_source', sourceId, asUserId(fixture.root));
    });

    expect(level).toBe('MANAGE');
    expect(
      await inOrg(fixture.organization, () =>
        repository.resourceLevel('mail_source', sourceId, asUserId(fixture.member)),
      ),
    ).toBeNull();
  });

  it('updateSource cambia nombre y cuenta, pero no la dirección ni el canal', async () => {
    const fixture = await seedFixture('cfg-update');
    const sourceId = await createSource(fixture, 'codes@cfg-update.example');

    const updated = await inOrg(fixture.organization, () =>
      repository.updateSource(sourceId, { displayName: 'Nuevo nombre', accountId: null }),
    );

    expect(updated).toMatchObject({
      id: sourceId,
      displayName: 'Nuevo nombre',
      address: 'codes@cfg-update.example',
      channel: 'mail',
    });
  });

  it('archiveSource archiva fuente y vistas y revoca las comparticiones de ambas', async () => {
    const fixture = await seedFixture('cfg-archive');
    const sourceId = await createSource(fixture, 'codes@cfg-archive.example');
    const viewId = await createView(fixture, sourceId, 'Vista');
    await db.admin.query(
      `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_source', $2, 'user', $3, 'EDIT', $4),
              ($1, 'mail_view', $5, 'user', $3, 'USE', $4)`,
      [fixture.organization, sourceId, fixture.member, fixture.root, viewId],
    );

    const result = await inOrg(fixture.organization, () =>
      repository.archiveSource(sourceId, NOW, asUserId(fixture.root)),
    );

    expect(result).toEqual({ revokedShares: 2 });
    const source = await db.admin.query<{ status: string; archived_at: Date | null }>(
      'select status, archived_at from mail_sources where id = $1',
      [sourceId],
    );
    const view = await db.admin.query<{ archived_at: Date | null }>(
      'select archived_at from mail_views where id = $1',
      [viewId],
    );
    const live = await db.admin.query<{ n: string }>(
      'select count(*)::text as n from shares where organization_id = $1 and revoked_at is null',
      [fixture.organization],
    );
    expect(source.rows[0]?.status).toBe('archived');
    expect(source.rows[0]?.archived_at).not.toBeNull();
    expect(view.rows[0]?.archived_at).not.toBeNull();
    expect(live.rows[0]?.n).toBe('0');
    // Archivada, ya no se puede editar ni bloquear.
    expect(
      await inOrg(fixture.organization, () => repository.findSourceForUpdate(sourceId)),
    ).toBeNull();
    expect(
      await inOrg(fixture.organization, () => repository.findViewForUpdate(viewId)),
    ).toBeNull();
  });
});

describe('PgInboundConfigurationRepository: vistas y plantillas', () => {
  it('un nombre repetido en la misma fuente se responde name_taken; en otra fuente es válido', async () => {
    const fixture = await seedFixture('cfg-view-name');
    const sourceA = await createSource(fixture, 'a@cfg-view-name.example');
    const sourceB = await createSource(fixture, 'b@cfg-view-name.example');
    await createView(fixture, sourceA, 'Principal');

    const duplicate = await inOrg(fixture.organization, () =>
      repository.insertView({
        id: ids.next(),
        sourceId: sourceA,
        name: 'Principal',
        createdBy: asUserId(fixture.root),
      }),
    );
    const otherSource = await inOrg(fixture.organization, () =>
      repository.insertView({
        id: ids.next(),
        sourceId: sourceB,
        name: 'Principal',
        createdBy: asUserId(fixture.root),
      }),
    );

    expect(duplicate).toBe('name_taken');
    expect(otherSource).toBe('inserted');
  });

  it('renameView respeta el nombre ya usado en la fuente', async () => {
    const fixture = await seedFixture('cfg-rename');
    const sourceId = await createSource(fixture, 'a@cfg-rename.example');
    await createView(fixture, sourceId, 'Uno');
    const second = await createView(fixture, sourceId, 'Dos');

    expect(await inOrg(fixture.organization, () => repository.renameView(second, 'Uno'))).toBe(
      'name_taken',
    );
    expect(await inOrg(fixture.organization, () => repository.renameView(second, 'Tres'))).toBe(
      'renamed',
    );
  });

  it('replaceTemplates deja exactamente las plantillas pedidas y cuenta lo agregado y lo quitado', async () => {
    const fixture = await seedFixture('cfg-templates');
    const sourceId = await createSource(fixture, 'a@cfg-templates.example');
    const viewId = await createView(fixture, sourceId, 'Vista');
    const [first, second, third] = [
      await seedTemplate(fixture),
      await seedTemplate(fixture),
      await seedTemplate(fixture),
    ] as [string, string, string];

    const initial = await inOrg(fixture.organization, () =>
      repository.replaceTemplates(viewId, [first, second]),
    );
    const change = await inOrg(fixture.organization, () =>
      repository.replaceTemplates(viewId, [second, third]),
    );
    const view = await inOrg(fixture.organization, () => repository.findView(viewId));

    expect(initial).toEqual({ added: 2, removed: 0 });
    expect(change).toEqual({ added: 1, removed: 1 });
    expect([...(view?.templateIds ?? [])].sort()).toEqual([second, third].sort());
  });

  it('countLiveTemplates no cuenta archivadas ni de otra organización', async () => {
    const mine = await seedFixture('cfg-count-a');
    const theirs = await seedFixture('cfg-count-b');
    const live = await seedTemplate(mine);
    const archived = await seedTemplate(mine, true);
    const foreign = await seedTemplate(theirs);

    const count = await inOrg(mine.organization, () =>
      repository.countLiveTemplates([live, archived, foreign]),
    );

    expect(count).toBe(1);
  });

  it('archiveView archiva la vista, revoca sus comparticiones y no toca la fuente', async () => {
    const fixture = await seedFixture('cfg-archive-view');
    const sourceId = await createSource(fixture, 'a@cfg-archive-view.example');
    const viewId = await createView(fixture, sourceId, 'Vista');
    await db.admin.query(
      `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'user', $3, 'USE', $4)`,
      [fixture.organization, viewId, fixture.member, fixture.root],
    );

    const result = await inOrg(fixture.organization, () =>
      repository.archiveView(viewId, NOW, asUserId(fixture.root)),
    );

    expect(result).toEqual({ revokedShares: 1 });
    expect(
      await inOrg(fixture.organization, () => repository.findSourceForUpdate(sourceId)),
    ).not.toBeNull();
    expect(
      await inOrg(fixture.organization, () => repository.findViewForUpdate(viewId)),
    ).toBeNull();
  });
});
