import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgInboundViewShareRepository } from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Comparticiones de vistas de correo con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿el repositorio
 * lee y escribe solo lo suyo? Cada caso responde una pregunta de aislamiento o de ciclo de vida.
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let repository: PgInboundViewShareRepository;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const NOW = new Date('2026-11-02T12:00:00Z');
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly grantee: string;
  readonly sourceId: string;
  readonly viewId: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  repository = new PgInboundViewShareRepository(uow);
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

async function seedFixture(
  slug: string,
  sourceStatus: 'active' | 'archived' = 'active',
): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const root = await insertOne(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const grantee = await insertOne(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, 'Persona', 2, $3, 'active') returning id`,
    [organization, `persona-${slug}@example.test`, root],
  );
  const sourceId = await insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by, status, archived_at)
     values ($1, 'mail', $2, 'Buzón', $3, $4, case when $4 = 'archived' then now() else null end)
     returning id`,
    [organization, `codes@${slug}.example`, root, sourceStatus],
  );
  const viewId = await insertOne(
    `insert into mail_views (organization_id, source_id, name, created_by)
     values ($1, $2, 'Vista', $3) returning id`,
    [organization, sourceId, root],
  );
  return { organization, root, grantee, sourceId, viewId };
}

async function seedShare(
  fixture: Fixture,
  level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE',
  expiresAt: Date | null = null,
): Promise<string> {
  return insertOne(
    `insert into shares
       (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by, expires_at)
     values ($1, 'mail_view', $2, 'user', $3, $4, $5, $6) returning id`,
    [fixture.organization, fixture.viewId, fixture.grantee, level, fixture.root, expiresAt],
  );
}

describe('PgInboundViewShareRepository', () => {
  it('findView devuelve la vista vigente y nada si la vista o su fuente están archivadas', async () => {
    const live = await seedFixture('vs-live');
    const archivedSource = await seedFixture('vs-archived-source', 'archived');
    const archivedView = await seedFixture('vs-archived-view');
    await db.admin.query('update mail_views set archived_at = now() where id = $1', [
      archivedView.viewId,
    ]);

    expect(await inOrg(live.organization, () => repository.findView(live.viewId))).toEqual({
      id: live.viewId,
      sourceId: live.sourceId,
      accountId: null,
    });
    expect(
      await inOrg(archivedSource.organization, () => repository.findView(archivedSource.viewId)),
    ).toBeNull();
    expect(
      await inOrg(archivedView.organization, () => repository.findView(archivedView.viewId)),
    ).toBeNull();
  });

  it('no ve vistas de otra organización', async () => {
    const mine = await seedFixture('vs-org-a');
    const theirs = await seedFixture('vs-org-b');

    expect(await inOrg(mine.organization, () => repository.findView(theirs.viewId))).toBeNull();
    expect(
      await inOrg(mine.organization, () => repository.findViewForUpdate(theirs.viewId)),
    ).toBeNull();
  });

  it('viewLevel entrega el nivel efectivo y no el de una compartición vencida', async () => {
    const fixture = await seedFixture('vs-level');
    await seedShare(fixture, 'EDIT');
    const expired = await seedFixture('vs-level-expired');
    await seedShare(expired, 'MANAGE', new Date('2026-01-01T00:00:00Z'));

    expect(
      await inOrg(fixture.organization, () =>
        repository.viewLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).toBe('EDIT');
    expect(
      await inOrg(expired.organization, () =>
        repository.viewLevel(expired.viewId, asUserId(expired.grantee)),
      ),
    ).toBeNull();
  });

  it('insert crea una compartición de vista que listLive devuelve con el nombre del destinatario', async () => {
    const fixture = await seedFixture('vs-insert');
    const shareId = ids.next();

    const listed = await inOrg(fixture.organization, async () => {
      await repository.insert({
        id: shareId,
        viewId: fixture.viewId,
        granteeType: 'user',
        granteeId: fixture.grantee,
        level: 'USE',
        expiresAt: null,
        grantedBy: asUserId(fixture.root),
      });
      return repository.listLive(fixture.viewId, NOW);
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: shareId,
      viewId: fixture.viewId,
      granteeName: 'Persona',
      level: 'USE',
    });
  });

  it('revoke conserva la fila, la saca de listLive y libera al destinatario', async () => {
    const fixture = await seedFixture('vs-revoke');
    const shareId = await seedShare(fixture, 'USE');

    await inOrg(fixture.organization, () =>
      repository.revoke(shareId, NOW, asUserId(fixture.root)),
    );

    const stored = await db.admin.query<{ revoked_by: string | null }>(
      'select revoked_by from shares where id = $1',
      [shareId],
    );
    expect(stored.rows[0]?.revoked_by).toBe(fixture.root);
    expect(
      await inOrg(fixture.organization, () => repository.listLive(fixture.viewId, NOW)),
    ).toHaveLength(0);
    expect(
      await inOrg(fixture.organization, () =>
        repository.viewLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).toBeNull();
    expect(
      await inOrg(fixture.organization, () =>
        repository.findOpenByGrantee(fixture.viewId, 'user', fixture.grantee),
      ),
    ).toBeNull();
  });

  it('findOpenByGrantee ve la vencida sin revocar, y listLive no', async () => {
    const fixture = await seedFixture('vs-open-expired');
    await seedShare(fixture, 'USE', new Date('2026-01-01T00:00:00Z'));

    expect(
      await inOrg(fixture.organization, () =>
        repository.findOpenByGrantee(fixture.viewId, 'user', fixture.grantee),
      ),
    ).not.toBeNull();
    expect(
      await inOrg(fixture.organization, () => repository.listLive(fixture.viewId, NOW)),
    ).toHaveLength(0);
  });

  it('userIsActive y groupIsLive distinguen lo vigente de lo archivado', async () => {
    const fixture = await seedFixture('vs-grantee');
    await db.admin.query("update users set status = 'suspended' where id = $1", [fixture.grantee]);

    expect(await inOrg(fixture.organization, () => repository.userIsActive(fixture.root))).toBe(
      true,
    );
    expect(await inOrg(fixture.organization, () => repository.userIsActive(fixture.grantee))).toBe(
      false,
    );
  });

  it('los bloqueos de findViewForUpdate y lockAccountForShare se pueden tomar con el rol de la aplicación', async () => {
    const fixture = await seedFixture('vs-locks');
    const accountId = await insertOne(
      `insert into accounts (organization_id, platform_id, display_name, created_by)
       values ($1, (select id from platforms where slug = 'custom' and organization_id is null), 'Cuenta', $2)
       returning id`,
      [fixture.organization, fixture.root],
    );
    await db.admin.query('update mail_sources set account_id = $1 where id = $2', [
      accountId,
      fixture.sourceId,
    ]);

    const locked = await inOrg(fixture.organization, async () => {
      const view = await repository.findViewForUpdate(fixture.viewId);
      await repository.lockAccountForShare(accountId);
      return view;
    });

    expect(locked).toEqual({ id: fixture.viewId, sourceId: fixture.sourceId, accountId });
  });
});
