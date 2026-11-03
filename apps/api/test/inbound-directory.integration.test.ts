import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgInboundDirectory } from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Listados de fuentes y vistas con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿solo aparece lo que
 * la persona alcanza por acceso efectivo, de su organización, y solo las vistas que hoy se pueden leer?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let directory: PgInboundDirectory;
const requestContext = new AsyncLocalRequestContext();
const LIMIT = 50;

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly person: string;
  readonly slug: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  directory = new PgInboundDirectory(uow);
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
    `insert into users (organization_id, email, display_name, rank)
     values ($1, $2, 'Raíz', 0) returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const person = await insertOne(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, 'Persona', 2, $3, 'active') returning id`,
    [organization, `persona-${slug}@example.test`, root],
  );
  return { organization, root, person, slug };
}

async function seedSource(
  fixture: Fixture,
  displayName: string,
  options: {
    readonly status?: 'active' | 'suspended' | 'archived';
    readonly accountId?: string | null;
  } = {},
): Promise<string> {
  const status = options.status ?? 'active';
  return insertOne(
    `insert into mail_sources
       (organization_id, channel, address, display_name, account_id, created_by, status, archived_at)
     values ($1, 'mail', $2, $3, $4, $5, $6, case when $6 = 'archived' then now() else null end)
     returning id`,
    [
      fixture.organization,
      `${displayName.toLowerCase().replaceAll(' ', '-')}@${fixture.slug}.example`,
      displayName,
      options.accountId ?? null,
      fixture.root,
      status,
    ],
  );
}

const seedView = (fixture: Fixture, sourceId: string, name: string, archived = false) =>
  insertOne(
    `insert into mail_views (organization_id, source_id, name, created_by, archived_at)
     values ($1, $2, $3, $4, case when $5 then now() else null end) returning id`,
    [fixture.organization, sourceId, name, fixture.root, archived],
  );

async function share(
  fixture: Fixture,
  resourceType: 'mail_view' | 'mail_source',
  resourceId: string,
  granteeType: 'user' | 'group',
  granteeId: string,
  level: 'VIEW' | 'USE' | 'EDIT' | 'MANAGE',
  options: { readonly revoked?: boolean } = {},
): Promise<void> {
  await db.admin.query(
    `insert into shares
       (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by,
        revoked_at, revoked_by)
     values ($1, $2, $3, $4, $5, $6, $7,
             case when $8 then now() else null end, case when $8 then $7::uuid else null end)`,
    [
      fixture.organization,
      resourceType,
      resourceId,
      granteeType,
      granteeId,
      level,
      fixture.root,
      options.revoked === true,
    ],
  );
}

async function seedAccount(fixture: Fixture, archived: boolean): Promise<string> {
  return insertOne(
    `insert into accounts (organization_id, platform_id, display_name, created_by, status, archived_at)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), 'Cuenta', $2,
             case when $3 then 'archived' else 'active' end, case when $3 then now() else null end)
     returning id`,
    [fixture.organization, fixture.root, archived],
  );
}

async function seedTemplate(
  fixture: Fixture,
  name: string,
  kind: 'login_code' | 'reset_code' | 'reset_link',
  archived = false,
): Promise<string> {
  return insertOne(
    `insert into inbound_templates (organization_id, name, kind, definition, created_by, archived_at)
     values ($1, $2, $3, '{}'::jsonb, $4, case when $5 then now() else null end) returning id`,
    [fixture.organization, name, kind, fixture.root, archived],
  );
}

async function linkTemplate(fixture: Fixture, viewId: string, templateId: string): Promise<void> {
  await db.admin.query(
    'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
    [fixture.organization, viewId, templateId],
  );
}

describe('PgInboundDirectory.listReadableViews', () => {
  it('lists only live views the person reaches, ordered by name, with the effective level', async () => {
    const fixture = await seedFixture('dir-views');
    const activeSource = await seedSource(fixture, 'Soporte');
    const suspendedSource = await seedSource(fixture, 'Suspendida', { status: 'suspended' });
    const archivedAccount = await seedAccount(fixture, true);
    const deadAccountSource = await seedSource(fixture, 'Con cuenta archivada', {
      accountId: archivedAccount,
    });
    const liveAccount = await seedAccount(fixture, false);
    const liveAccountSource = await seedSource(fixture, 'Con cuenta activa', {
      accountId: liveAccount,
    });

    const zeta = await seedView(fixture, activeSource, 'Zeta');
    const alfa = await seedView(fixture, liveAccountSource, 'Alfa');
    const archivedView = await seedView(fixture, activeSource, 'Archivada', true);
    const onSuspended = await seedView(fixture, suspendedSource, 'En suspendida');
    const onDeadAccount = await seedView(fixture, deadAccountSource, 'En cuenta archivada');
    const notShared = await seedView(fixture, activeSource, 'Sin compartir');
    const revoked = await seedView(fixture, activeSource, 'Revocada');

    await share(fixture, 'mail_view', zeta, 'user', fixture.person, 'USE');
    await share(fixture, 'mail_view', alfa, 'user', fixture.person, 'MANAGE');
    await share(fixture, 'mail_view', archivedView, 'user', fixture.person, 'USE');
    await share(fixture, 'mail_view', onSuspended, 'user', fixture.person, 'USE');
    await share(fixture, 'mail_view', onDeadAccount, 'user', fixture.person, 'USE');
    await share(fixture, 'mail_view', revoked, 'user', fixture.person, 'USE', { revoked: true });
    // La fuente compartida no da acceso a sus vistas: cada vista se comparte por separado.
    await share(fixture, 'mail_source', activeSource, 'user', fixture.person, 'MANAGE');

    const views = await inOrg(fixture.organization, () =>
      directory.listReadableViews(asUserId(fixture.person), LIMIT),
    );

    expect(views).toEqual([
      {
        id: alfa,
        name: 'Alfa',
        sourceId: liveAccountSource,
        sourceDisplayName: 'Con cuenta activa',
        channel: 'mail',
        level: 'MANAGE',
      },
      {
        id: zeta,
        name: 'Zeta',
        sourceId: activeSource,
        sourceDisplayName: 'Soporte',
        channel: 'mail',
        level: 'USE',
      },
    ]);
    expect(views.map((view) => view.id)).not.toContain(notShared);
  });

  it('includes views reached through a group with the highest level', async () => {
    const fixture = await seedFixture('dir-views-group');
    const source = await seedSource(fixture, 'Soporte');
    const view = await seedView(fixture, source, 'Grupo');
    const groupId = await insertOne(
      `insert into groups (organization_id, name, created_by) values ($1, 'Soporte', $2) returning id`,
      [fixture.organization, fixture.root],
    );
    await db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [fixture.organization, groupId, fixture.person, fixture.root],
    );
    await share(fixture, 'mail_view', view, 'group', groupId, 'EDIT');
    await share(fixture, 'mail_view', view, 'user', fixture.person, 'VIEW');

    const views = await inOrg(fixture.organization, () =>
      directory.listReadableViews(asUserId(fixture.person), LIMIT),
    );

    expect(views).toEqual([expect.objectContaining({ id: view, level: 'EDIT' })]);
  });

  it('never lists what only another person of the same organization reaches', async () => {
    const fixture = await seedFixture('dir-views-peer');
    const peer = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, 'peer-dir-views@example.test', 'Par', 2, $2, 'active') returning id`,
      [fixture.organization, fixture.root],
    );
    const source = await seedSource(fixture, 'Soporte');
    const peerView = await seedView(fixture, source, 'Del par');
    await share(fixture, 'mail_view', peerView, 'user', peer, 'MANAGE');
    await share(fixture, 'mail_source', source, 'user', peer, 'MANAGE');

    const [views, sources] = await inOrg(fixture.organization, async () => [
      await directory.listReadableViews(asUserId(fixture.person), LIMIT),
      await directory.listConfigurableSources(asUserId(fixture.person), LIMIT),
    ]);

    expect(views).toEqual([]);
    expect(sources).toEqual([]);
  });

  it('honors the limit', async () => {
    const fixture = await seedFixture('dir-views-limit');
    const source = await seedSource(fixture, 'Soporte');
    for (const name of ['A', 'B', 'C']) {
      const view = await seedView(fixture, source, name);
      await share(fixture, 'mail_view', view, 'user', fixture.person, 'USE');
    }

    const views = await inOrg(fixture.organization, () =>
      directory.listReadableViews(asUserId(fixture.person), 2),
    );

    expect(views.map((view) => view.name)).toEqual(['A', 'B']);
  });

  it('never lists another organization views, even for the same person id', async () => {
    const owner = await seedFixture('dir-views-owner');
    const other = await seedFixture('dir-views-other');
    const source = await seedSource(owner, 'Soporte');
    const view = await seedView(owner, source, 'Ajena');
    await share(owner, 'mail_view', view, 'user', owner.person, 'MANAGE');

    const fromOther = await inOrg(other.organization, () =>
      directory.listReadableViews(asUserId(owner.person), LIMIT),
    );

    expect(fromOther).toEqual([]);
  });
});

describe('PgInboundDirectory.listConfigurableSources', () => {
  it('lists non-archived sources the person reaches, ordered by display name, with the level', async () => {
    const fixture = await seedFixture('dir-sources');
    const zeta = await seedSource(fixture, 'Zeta');
    const alfa = await seedSource(fixture, 'Alfa', { status: 'suspended' });
    const archived = await seedSource(fixture, 'Archivada', { status: 'archived' });
    const notShared = await seedSource(fixture, 'Sin compartir');
    const revoked = await seedSource(fixture, 'Revocada');
    await share(fixture, 'mail_source', zeta, 'user', fixture.person, 'MANAGE');
    await share(fixture, 'mail_source', alfa, 'user', fixture.person, 'VIEW');
    await share(fixture, 'mail_source', archived, 'user', fixture.person, 'MANAGE');
    await share(fixture, 'mail_source', revoked, 'user', fixture.person, 'MANAGE', {
      revoked: true,
    });
    // Una vista compartida no da acceso a la configuración de su fuente.
    const view = await seedView(fixture, notShared, 'Vista');
    await share(fixture, 'mail_view', view, 'user', fixture.person, 'MANAGE');

    const sources = await inOrg(fixture.organization, () =>
      directory.listConfigurableSources(asUserId(fixture.person), LIMIT),
    );

    expect(sources.map((source) => [source.id, source.status, source.level])).toEqual([
      [alfa, 'suspended', 'VIEW'],
      [zeta, 'active', 'MANAGE'],
    ]);
    expect(sources[1]).toEqual({
      id: zeta,
      channel: 'mail',
      address: `zeta@${fixture.slug}.example`,
      displayName: 'Zeta',
      accountId: null,
      status: 'active',
      createdAt: expect.any(Date) as Date,
      level: 'MANAGE',
    });
  });

  it('never lists another organization sources', async () => {
    const owner = await seedFixture('dir-sources-owner');
    const other = await seedFixture('dir-sources-other');
    const source = await seedSource(owner, 'Ajena');
    await share(owner, 'mail_source', source, 'user', owner.person, 'MANAGE');

    const fromOther = await inOrg(other.organization, () =>
      directory.listConfigurableSources(asUserId(owner.person), LIMIT),
    );

    expect(fromOther).toEqual([]);
  });
});

describe('PgInboundDirectory.listConfigurableViews', () => {
  it('lists live views of non-archived sources the person reaches, with templates and level', async () => {
    const fixture = await seedFixture('dir-config-views');
    const active = await seedSource(fixture, 'Activa');
    const suspended = await seedSource(fixture, 'Suspendida', { status: 'suspended' });
    const archivedSource = await seedSource(fixture, 'Archivada', { status: 'archived' });
    const zeta = await seedView(fixture, active, 'Zeta');
    const alfa = await seedView(fixture, suspended, 'Alfa');
    const empty = await seedView(fixture, active, 'Sin plantillas');
    const archivedView = await seedView(fixture, active, 'Vista archivada', true);
    const ofArchivedSource = await seedView(fixture, archivedSource, 'De fuente archivada');
    const notShared = await seedView(fixture, active, 'Sin compartir');
    const revoked = await seedView(fixture, active, 'Revocada');
    const login = await seedTemplate(fixture, 'Acceso', 'login_code');
    const reset = await seedTemplate(fixture, 'Restablecer', 'reset_code');
    await linkTemplate(fixture, zeta, login);
    await linkTemplate(fixture, zeta, reset);
    await linkTemplate(fixture, alfa, login);
    for (const viewId of [zeta, alfa, empty, archivedView, ofArchivedSource]) {
      await share(fixture, 'mail_view', viewId, 'user', fixture.person, 'EDIT');
    }
    await share(fixture, 'mail_view', revoked, 'user', fixture.person, 'MANAGE', { revoked: true });
    // Tener nivel sobre la fuente no da acceso a la configuración de sus vistas.
    await share(fixture, 'mail_source', active, 'user', fixture.person, 'MANAGE');

    const views = await inOrg(fixture.organization, () =>
      directory.listConfigurableViews(asUserId(fixture.person), LIMIT),
    );

    expect(views.map((view) => view.id)).toEqual([alfa, empty, zeta]);
    expect(views.find((view) => view.id === zeta)).toEqual({
      id: zeta,
      sourceId: active,
      name: 'Zeta',
      templateIds: [login, reset].sort(),
      createdAt: expect.any(Date) as Date,
      level: 'EDIT',
    });
    expect(views.find((view) => view.id === empty)?.templateIds).toEqual([]);
    expect(views.map((view) => view.id)).not.toContain(notShared);
  });

  it('never lists what only another person of the same organization reaches', async () => {
    const fixture = await seedFixture('dir-config-views-peer');
    const peer = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, $2, 'Colega', 2, $3, 'active') returning id`,
      [fixture.organization, `colega-${fixture.slug}@example.test`, fixture.root],
    );
    const source = await seedSource(fixture, 'Fuente');
    const view = await seedView(fixture, source, 'Ajena');
    await share(fixture, 'mail_view', view, 'user', peer, 'MANAGE');

    const views = await inOrg(fixture.organization, () =>
      directory.listConfigurableViews(asUserId(fixture.person), LIMIT),
    );

    expect(views).toEqual([]);
  });

  it('counts views, not template rows, against the limit', async () => {
    const fixture = await seedFixture('dir-config-views-limit');
    const source = await seedSource(fixture, 'Fuente');
    const first = await seedView(fixture, source, 'A');
    const second = await seedView(fixture, source, 'B');
    for (const viewId of [first, second]) {
      await share(fixture, 'mail_view', viewId, 'user', fixture.person, 'EDIT');
    }
    for (const name of ['T1', 'T2', 'T3']) {
      await linkTemplate(fixture, first, await seedTemplate(fixture, name, 'login_code'));
    }

    const views = await inOrg(fixture.organization, () =>
      directory.listConfigurableViews(asUserId(fixture.person), 2),
    );

    expect(views.map((view) => [view.id, view.templateIds.length])).toEqual([
      [first, 3],
      [second, 0],
    ]);
  });

  it('never lists another organization views', async () => {
    const owner = await seedFixture('dir-config-views-owner');
    const other = await seedFixture('dir-config-views-other');
    const source = await seedSource(owner, 'Ajena');
    const view = await seedView(owner, source, 'Vista');
    await share(owner, 'mail_view', view, 'user', owner.person, 'MANAGE');

    const fromOther = await inOrg(other.organization, () =>
      directory.listConfigurableViews(asUserId(owner.person), LIMIT),
    );

    expect(fromOther).toEqual([]);
  });
});

describe('PgInboundDirectory.listLiveTemplates', () => {
  it('lists only the live templates of the organization, ordered by name, without definitions', async () => {
    const owner = await seedFixture('dir-templates');
    const other = await seedFixture('dir-templates-other');
    const zeta = await seedTemplate(owner, 'Zeta', 'reset_link');
    const alfa = await seedTemplate(owner, 'Alfa', 'login_code');
    await seedTemplate(owner, 'Archivada', 'login_code', true);
    await seedTemplate(other, 'De otra organización', 'login_code');

    const templates = await inOrg(owner.organization, () => directory.listLiveTemplates(LIMIT));

    expect(templates).toEqual([
      { id: alfa, name: 'Alfa', kind: 'login_code' },
      { id: zeta, name: 'Zeta', kind: 'reset_link' },
    ]);
  });

  it('honors the limit', async () => {
    const fixture = await seedFixture('dir-templates-limit');
    const first = await seedTemplate(fixture, 'A', 'login_code');
    await seedTemplate(fixture, 'B', 'login_code');

    const templates = await inOrg(fixture.organization, () => directory.listLiveTemplates(1));

    expect(templates.map((template) => template.id)).toEqual([first]);
  });
});
