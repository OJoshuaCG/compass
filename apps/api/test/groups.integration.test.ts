/**
 * SENSIBLE (ruta protegida: acceso y aislamiento). Esta prueba la debe revisar una persona.
 *
 * Grupos y membresías con el rol de la aplicación (`iam_app`, sin BYPASSRLS): nombre vivo único por
 * organización sin distinguir mayúsculas, lectura aislada por organización y miembros con su papel.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgGroupStore } from '../src/modules/directory/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

let db: TestDatabase;
let uow: PgUnitOfWork;
let store: PgGroupStore;
const requestContext = new AsyncLocalRequestContext();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly manager: string;
  readonly member: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  store = new PgGroupStore(uow);
});

afterAll(async () => {
  await db.close();
});

async function insertUser(
  organization: string,
  email: string,
  name: string,
  rank: number,
  managedBy: string | null,
): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, $3, $4, $5, 'active') returning id`,
    [organization, email, name, rank, managedBy],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  // La Raíz no tiene responsable y todo rango inferior debe tener uno (restricción de la base).
  const root = await insertUser(organization, `root-${slug}@example.test`, 'Raíz', 0, null);
  const manager = await insertUser(
    organization,
    `manager-${slug}@example.test`,
    'Gestora',
    2,
    root,
  );
  const member = await insertUser(
    organization,
    `member-${slug}@example.test`,
    'Miembro',
    3,
    manager,
  );
  return { organization, manager, member };
}

describe('groups on PostgreSQL', () => {
  it('rejects a live name already taken in the organization, ignoring case, without aborting the transaction', async () => {
    const f = await seedFixture('groups-name');
    const outcome = await inOrg(f.organization, async () => {
      const first = await store.insertGroup({
        name: 'Redes',
        description: null,
        createdBy: f.manager,
      });
      const duplicate = await store.insertGroup({
        name: 'REDES',
        description: null,
        createdBy: f.manager,
      });
      const afterwards = await store.insertGroup({
        name: 'Otro',
        description: null,
        createdBy: f.manager,
      });
      return { first, duplicate, afterwards };
    });
    expect(outcome.first).not.toBeNull();
    expect(outcome.duplicate).toBeNull();
    expect(outcome.afterwards).not.toBeNull();
  });

  it('allows the same name in another organization', async () => {
    const a = await seedFixture('groups-iso-a');
    const b = await seedFixture('groups-iso-b');
    const inA = await inOrg(a.organization, () =>
      store.insertGroup({ name: 'Compartido', description: null, createdBy: a.manager }),
    );
    const inB = await inOrg(b.organization, () =>
      store.insertGroup({ name: 'Compartido', description: null, createdBy: b.manager }),
    );
    expect(inA).not.toBeNull();
    expect(inB).not.toBeNull();
  });

  it('never shows or finds a group of another organization', async () => {
    const a = await seedFixture('groups-read-a');
    const b = await seedFixture('groups-read-b');
    const group = await inOrg(a.organization, () =>
      store.insertGroup({ name: 'Privado', description: null, createdBy: a.manager }),
    );
    if (group === null) throw new Error('seed failed');
    const listedInB = await inOrg(b.organization, () =>
      store.listLive({ viewerId: b.manager, onlyOfViewer: false, onlyManagedByViewer: false }),
    );
    const foundInB = await inOrg(b.organization, () => store.findLive(group.id));
    expect(listedInB).toEqual([]);
    expect(foundInB).toBeNull();
  });

  it('lists members with role and count, scopes by viewer and refuses a duplicate membership', async () => {
    const f = await seedFixture('groups-members');
    const result = await inOrg(f.organization, async () => {
      const group = await store.insertGroup({
        name: 'Equipo',
        description: 'x',
        createdBy: f.manager,
      });
      if (group === null) throw new Error('seed failed');
      await store.addMember({
        groupId: group.id,
        userId: f.manager,
        role: 'manager',
        addedBy: f.manager,
      });
      const added = await store.addMember({
        groupId: group.id,
        userId: f.member,
        role: 'member',
        addedBy: f.manager,
      });
      const addedAgain = await store.addMember({
        groupId: group.id,
        userId: f.member,
        role: 'member',
        addedBy: f.manager,
      });
      const members = await store.listMembers(group.id);
      const asMember = await store.listLive({
        viewerId: f.member,
        onlyOfViewer: true,
        onlyManagedByViewer: false,
      });
      const managedByMember = await store.listLive({
        viewerId: f.member,
        onlyOfViewer: false,
        onlyManagedByViewer: true,
      });
      const managers = await store.countManagers(group.id);
      await store.removeMember(group.id, f.member);
      const afterRemoval = await store.roleOf(group.id, f.member);
      return { added, addedAgain, members, asMember, managedByMember, managers, afterRemoval };
    });
    expect(result.added).toBe(true);
    expect(result.addedAgain).toBe(false);
    expect(result.members.map((m) => [m.displayName, m.role])).toEqual([
      ['Gestora', 'manager'],
      ['Miembro', 'member'],
    ]);
    expect(result.asMember).toMatchObject([
      { name: 'Equipo', memberCount: 2, roleOfViewer: 'member' },
    ]);
    expect(result.managedByMember).toEqual([]);
    expect(result.managers).toBe(1);
    expect(result.afterRemoval).toBeNull();
  });
});
