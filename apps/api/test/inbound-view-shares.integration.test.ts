import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { Authorizer } from '../src/modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from '../src/modules/audit/index.js';
import {
  ManageInboundViewShares,
  PgInboundViewShareRepository,
} from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { PgShareRepository } from '../src/modules/vault/index.js';
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

/** Cuenta de la bóveda ligada a la fuente de la vista, con una credencial viva y una archivada. */
async function linkAccount(fixture: Fixture) {
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
  const liveCredential = await insertOne(
    `insert into credentials (organization_id, account_id, label, kind, created_by)
     values ($1, $2, 'principal', 'password', $3) returning id`,
    [fixture.organization, accountId, fixture.root],
  );
  const archivedCredential = await insertOne(
    `insert into credentials (organization_id, account_id, label, kind, created_by, archived_at)
     values ($1, $2, 'vieja', 'password', $3, now()) returning id`,
    [fixture.organization, accountId, fixture.root],
  );
  return { accountId, liveCredential, archivedCredential };
}

const auditLog = () =>
  new RecordAuditEvent({
    repository: new PgAuditEventRepository(uow),
    context: requestContext,
    ids,
  });

/** Escribe la auditoría de una revelación tal como la deja `RevealInboundResets`. */
async function recordReveal(
  fixture: Fixture,
  input: {
    readonly actorId: string;
    readonly viewId: string;
    readonly targetType?: 'inbound_item' | 'mail_view';
    readonly outcome?: 'success' | 'failure';
  },
): Promise<void> {
  await inOrg(fixture.organization, async () => {
    const recorded = await auditLog().record({
      action: 'inbound.reset_revealed',
      actorId: asUserId(input.actorId),
      targetType: input.targetType ?? 'inbound_item',
      targetId: ids.next(),
      outcome: input.outcome ?? 'success',
      reasonCode: null,
      ip: null,
      requestId: 'req-test',
      metadata: { sourceId: fixture.sourceId, viewId: input.viewId, reason: 'soporte del cliente' },
    });
    if (!recorded.ok) throw recorded.error;
  });
}

describe('PgInboundViewShareRepository: datos para las tareas de rotación', () => {
  const LONG_AGO = new Date('2000-01-01T00:00:00Z');

  it('usersWhoRevealedResets solo cuenta revelaciones exitosas de elementos desde esta vista', async () => {
    const fixture = await seedFixture('vs-revealers');
    const otherView = await insertOne(
      `insert into mail_views (organization_id, source_id, name, created_by)
       values ($1, $2, 'Otra vista', $3) returning id`,
      [fixture.organization, fixture.sourceId, fixture.root],
    );
    const viaOtherView = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, 'otra-vista@vs-revealers.example.test', 'Otra', 2, $2, 'active') returning id`,
      [fixture.organization, fixture.root],
    );
    const onlyEmptyAttempt = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, 'vacio@vs-revealers.example.test', 'Vacío', 2, $2, 'active') returning id`,
      [fixture.organization, fixture.root],
    );
    await recordReveal(fixture, { actorId: fixture.grantee, viewId: fixture.viewId });
    await recordReveal(fixture, { actorId: fixture.grantee, viewId: fixture.viewId });
    await recordReveal(fixture, { actorId: viaOtherView, viewId: otherView });
    await recordReveal(fixture, {
      actorId: onlyEmptyAttempt,
      viewId: fixture.viewId,
      targetType: 'mail_view',
    });
    await recordReveal(fixture, {
      actorId: onlyEmptyAttempt,
      viewId: fixture.viewId,
      outcome: 'failure',
    });

    const candidates = [fixture.grantee, viaOtherView, onlyEmptyAttempt];
    const found = await inOrg(fixture.organization, () =>
      repository.usersWhoRevealedResets(fixture.viewId, candidates, LONG_AGO),
    );
    const afterWindow = await inOrg(fixture.organization, () =>
      repository.usersWhoRevealedResets(
        fixture.viewId,
        candidates,
        new Date('2999-01-01T00:00:00Z'),
      ),
    );
    const noCandidates = await inOrg(fixture.organization, () =>
      repository.usersWhoRevealedResets(fixture.viewId, [], LONG_AGO),
    );

    expect(found).toEqual([fixture.grantee]);
    expect(afterWindow).toEqual([]);
    expect(noCandidates).toEqual([]);
  });

  it('usersWhoRevealedResets no ve revelaciones de otra organización', async () => {
    const mine = await seedFixture('vs-revealers-mine');
    const theirs = await seedFixture('vs-revealers-theirs');
    await recordReveal(theirs, { actorId: theirs.grantee, viewId: mine.viewId });

    const found = await inOrg(mine.organization, () =>
      repository.usersWhoRevealedResets(mine.viewId, [theirs.grantee], LONG_AGO),
    );

    expect(found).toEqual([]);
  });

  it('liveCredentialIds devuelve solo las credenciales no archivadas de la cuenta', async () => {
    const fixture = await seedFixture('vs-credentials');
    const { accountId, liveCredential } = await linkAccount(fixture);

    const credentials = await inOrg(fixture.organization, () =>
      repository.liveCredentialIds(accountId),
    );

    expect(credentials).toEqual([liveCredential]);
  });

  it('groupMemberIds devuelve los miembros del grupo', async () => {
    const fixture = await seedFixture('vs-group-members');
    const groupId = await insertOne(
      `insert into groups (organization_id, name, created_by) values ($1, 'Soporte', $2) returning id`,
      [fixture.organization, fixture.root],
    );
    await db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [fixture.organization, groupId, fixture.grantee, fixture.root],
    );

    const members = await inOrg(fixture.organization, () => repository.groupMemberIds(groupId));

    expect(members).toEqual([fixture.grantee]);
  });
});

describe('ManageInboundViewShares.revoke con tareas de rotación reales', () => {
  /** Casos de uso reales; solo el autorizador es un doble porque el permiso no es lo que se prueba aquí. */
  function buildUseCase() {
    return new ManageInboundViewShares({
      context: requestContext,
      uow,
      authorizer: {
        require: () => Promise.resolve([]),
        auditDenial: () => Promise.resolve(),
      } as unknown as Authorizer,
      shares: repository,
      rotations: new PgShareRepository(uow),
      ids,
      audit: auditLog(),
      clock: { now: () => new Date() },
    });
  }

  /** El actor administra la vista; cada caso decide si el destinatario reveló un restablecimiento. */
  async function seedRevokable(slug: string) {
    const fixture = await seedFixture(slug);
    const actor = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, $2, 'Actor', 1, $3, 'active') returning id`,
      [fixture.organization, `actor-${slug}@example.test`, fixture.root],
    );
    await db.admin.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'user', $3, 'MANAGE', $4)`,
      [fixture.organization, fixture.viewId, actor, fixture.root],
    );
    const shareId = await seedShare(fixture, 'MANAGE');
    const linked = await linkAccount(fixture);
    return { fixture, actor, shareId, ...linked };
  }

  /** Corre como el actor dado (no el de `contextFor`): el caso de uso decide con su nivel sobre la vista. */
  const asActor = <T>(organization: string, actor: string, fn: () => Promise<T>): Promise<T> =>
    requestContext.run({ ...contextFor(organization), actorId: asUserId(actor) }, () =>
      uow.run(fn),
    );

  async function rotationTasksFor(organization: string, credentialId: string) {
    const result = await db.admin.query<{ trigger: string; triggered_by_user: string | null }>(
      `select trigger, triggered_by_user from rotation_tasks
        where organization_id = $1 and credential_id = $2`,
      [organization, credentialId],
    );
    return result.rows;
  }

  it('revocar a quien reveló crea una tarea share_revoked por credencial viva y la audita', async () => {
    const { fixture, actor, shareId, liveCredential, archivedCredential } =
      await seedRevokable('vs-rotation');
    await recordReveal(fixture, { actorId: fixture.grantee, viewId: fixture.viewId });

    const result = await asActor(fixture.organization, actor, () =>
      buildUseCase().revoke(fixture.viewId, shareId),
    );

    expect(result.ok).toBe(true);
    expect(await rotationTasksFor(fixture.organization, liveCredential)).toEqual([
      { trigger: 'share_revoked', triggered_by_user: fixture.grantee },
    ]);
    expect(await rotationTasksFor(fixture.organization, archivedCredential)).toEqual([]);
    const audit = await db.admin.query<{ metadata: { rotationTasks: number } }>(
      `select metadata from audit_events
        where organization_id = $1 and action = 'inbound.view_share_revoked'`,
      [fixture.organization],
    );
    expect(audit.rows.map((row) => row.metadata.rotationTasks)).toEqual([1]);
  });

  it('revocar a quien nunca reveló no crea tareas', async () => {
    const { fixture, actor, shareId, liveCredential } = await seedRevokable('vs-rotation-none');

    const result = await asActor(fixture.organization, actor, () =>
      buildUseCase().revoke(fixture.viewId, shareId),
    );

    expect(result.ok).toBe(true);
    expect(await rotationTasksFor(fixture.organization, liveCredential)).toEqual([]);
  });

  it('revocar a un grupo solo cuenta a los miembros que pierden MANAGE y no atribuye la tarea', async () => {
    const { fixture, actor, liveCredential } = await seedRevokable('vs-rotation-group');
    const keepsManage = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, 'conserva@vs-rotation-group.example.test', 'Conserva', 2, $2, 'active') returning id`,
      [fixture.organization, fixture.root],
    );
    const groupId = await insertOne(
      `insert into groups (organization_id, name, created_by) values ($1, 'Soporte', $2) returning id`,
      [fixture.organization, fixture.root],
    );
    for (const member of [fixture.grantee, keepsManage]) {
      await db.admin.query(
        `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
         values ($1, $2, $3, 'member', $4)`,
        [fixture.organization, groupId, member, fixture.root],
      );
    }
    const groupShare = await insertOne(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'group', $3, 'MANAGE', $4) returning id`,
      [fixture.organization, fixture.viewId, groupId, fixture.root],
    );
    // `keepsManage` conserva MANAGE por una compartición directa: puede volver a revelar.
    await db.admin.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'user', $3, 'MANAGE', $4)`,
      [fixture.organization, fixture.viewId, keepsManage, fixture.root],
    );
    await recordReveal(fixture, { actorId: keepsManage, viewId: fixture.viewId });

    const onlyKeeperRevealed = await asActor(fixture.organization, actor, () =>
      buildUseCase().revoke(fixture.viewId, groupShare),
    );

    expect(onlyKeeperRevealed.ok).toBe(true);
    expect(await rotationTasksFor(fixture.organization, liveCredential)).toEqual([]);
  });

  it('revocar a un grupo cuyo miembro reveló y pierde el acceso crea la tarea sin persona', async () => {
    const { fixture, actor, liveCredential } = await seedRevokable('vs-rotation-group-loses');
    const groupId = await insertOne(
      `insert into groups (organization_id, name, created_by) values ($1, 'Soporte', $2) returning id`,
      [fixture.organization, fixture.root],
    );
    const member = await insertOne(
      `insert into users (organization_id, email, display_name, rank, managed_by, status)
       values ($1, 'miembro@vs-rotation-group-loses.example.test', 'Miembro', 2, $2, 'active')
       returning id`,
      [fixture.organization, fixture.root],
    );
    await db.admin.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       values ($1, $2, $3, 'member', $4)`,
      [fixture.organization, groupId, member, fixture.root],
    );
    const groupShare = await insertOne(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'group', $3, 'MANAGE', $4) returning id`,
      [fixture.organization, fixture.viewId, groupId, fixture.root],
    );
    await recordReveal(fixture, { actorId: member, viewId: fixture.viewId });

    const result = await asActor(fixture.organization, actor, () =>
      buildUseCase().revoke(fixture.viewId, groupShare),
    );

    expect(result.ok).toBe(true);
    expect(await rotationTasksFor(fixture.organization, liveCredential)).toEqual([
      { trigger: 'share_revoked', triggered_by_user: null },
    ]);
  });
});
