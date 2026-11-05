import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgAuditEventRepository, RecordAuditEvent } from '../src/modules/audit/index.js';
import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import {
  PgInboundResetStore,
  PgInboundViewReader,
  RevealInboundResets,
  inboundItemContext,
} from '../src/modules/inbound-codes/index.js';
import type { Authorizer } from '../src/modules/access/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId, asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Restablecimientos de una vista con el rol de la aplicación (`iam_app`, sin BYPASSRLS). Cada caso responde
 * una pregunta de aislamiento (otra fuente que comparte plantilla, otra vista, otra organización, lo vencido,
 * los `login_code`) y la revelación real deja una auditoría por elemento y un aviso en el outbox.
 */

let db: TestDatabase;
let kekDir: string;
let uow: PgUnitOfWork;
let cipher: SecretCipher;
let store: PgInboundResetStore;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const NOW = new Date('2026-11-03T12:05:00Z');
const REASON = 'Soporte pidió restablecer el acceso';
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

type TemplateKind = 'login_code' | 'reset_code' | 'reset_link';

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly admin: string;
  readonly sourceId: string;
  readonly viewId: string;
  readonly resetTemplateId: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  kekDir = mkdtempSync(join(tmpdir(), 'iam-kek-'));
  const clock = new SystemClock();
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  cipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new PgDataKeyRepository(uow),
      kms: new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' }),
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => uow.run(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });
  store = new PgInboundResetStore(uow);
});

afterAll(async () => {
  await db.close();
  rmSync(kekDir, { recursive: true, force: true });
});

async function insertOne(sql: string, values: readonly unknown[]): Promise<string> {
  const result = await db.admin.query<{ id: string }>(sql, [...values]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

const seedSource = (organization: string, root: string, address: string) =>
  insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by)
     values ($1, 'mail', $2, 'Buzón', $3) returning id`,
    [organization, address, root],
  );

const seedView = (organization: string, sourceId: string, root: string) =>
  insertOne(
    `insert into mail_views (organization_id, source_id, name, created_by)
     values ($1, $2, 'Vista', $3) returning id`,
    [organization, sourceId, root],
  );

async function seedTemplate(
  organization: string,
  root: string,
  viewId: string | null,
  kind: TemplateKind,
): Promise<string> {
  const templateId = await insertOne(
    `insert into inbound_templates (organization_id, name, kind, definition, created_by)
     values ($1, $2, $3, '{}'::jsonb, $4) returning id`,
    [organization, `Plantilla ${ids.next()}`, kind, root],
  );
  if (viewId !== null) {
    await db.admin.query(
      'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
      [organization, viewId, templateId],
    );
  }
  return templateId;
}

/** Organización con una fuente, una vista con una plantilla `reset_code` y una persona de Administración. */
async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const root = await insertOne(
    `insert into users (organization_id, email, display_name, rank)
     values ($1, $2, 'Raíz', 0) returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const admin = await insertOne(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, 'Administración', 1, $3, 'active') returning id`,
    [organization, `admin-${slug}@example.test`, root],
  );
  const sourceId = await seedSource(organization, root, `resets@${slug}.example`);
  const viewId = await seedView(organization, sourceId, root);
  const resetTemplateId = await seedTemplate(organization, root, viewId, 'reset_code');
  return { organization, root, admin, sourceId, viewId, resetTemplateId };
}

interface ItemSeed {
  readonly kind?: TemplateKind;
  readonly expiresAt?: Date;
  readonly createdAt?: Date;
  readonly value?: string;
}

async function seedItem(
  fixture: Fixture,
  templateId: string,
  sourceId: string,
  seed: ItemSeed = {},
): Promise<string> {
  const itemId = ids.next();
  const kind = seed.kind ?? 'reset_code';
  const sealed = await inOrg(fixture.organization, () =>
    cipher.encrypt(
      inboundItemContext(asOrganizationId(fixture.organization), itemId),
      text(seed.value ?? '555111'),
    ),
  );
  if (!sealed.ok) throw new Error(sealed.error.code);
  await db.admin.query(
    `insert into inbound_items
       (id, organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce,
        dek_version, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      itemId,
      fixture.organization,
      sourceId,
      templateId,
      kind,
      kind === 'reset_link' ? 'link' : 'code',
      kind === 'login_code' ? 'visible_with_use' : 'sensitive',
      Buffer.from(sealed.value.ciphertext),
      Buffer.from(sealed.value.nonce),
      sealed.value.dekVersion,
      seed.expiresAt ?? new Date('2026-11-03T12:30:00Z'),
      seed.createdAt ?? new Date('2026-11-03T12:00:00Z'),
    ],
  );
  return itemId;
}

const list = (fixture: Fixture, limit = 20) =>
  inOrg(fixture.organization, () => store.listLiveResets(fixture.viewId, NOW, limit));

describe('PgInboundResetStore.listLiveResets', () => {
  it('returns live reset codes and links that open with the item context', async () => {
    const fixture = await seedFixture('rs-live');
    const linkTemplate = await seedTemplate(
      fixture.organization,
      fixture.root,
      fixture.viewId,
      'reset_link',
    );
    const codeId = await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId, {
      createdAt: new Date('2026-11-03T12:00:00Z'),
    });
    const linkId = await seedItem(fixture, linkTemplate, fixture.sourceId, {
      kind: 'reset_link',
      value: 'https://provider.example/reset?t=abc',
      createdAt: new Date('2026-11-03T12:01:00Z'),
    });

    const records = await list(fixture);

    expect(records.map((record) => [record.itemId, record.kind, record.valueType])).toEqual([
      [linkId, 'reset_link', 'link'],
      [codeId, 'reset_code', 'code'],
    ]);
    const opened = await inOrg(fixture.organization, () =>
      cipher.decrypt(inboundItemContext(asOrganizationId(fixture.organization), linkId), {
        ciphertext: records[0]?.ciphertext ?? new Uint8Array(),
        nonce: records[0]?.nonce ?? new Uint8Array(),
        dekVersion: records[0]?.dekVersion ?? 0,
      }),
    );
    expect(opened.ok && new TextDecoder().decode(opened.value)).toBe(
      'https://provider.example/reset?t=abc',
    );
  });

  it('never returns a login code', async () => {
    const fixture = await seedFixture('rs-login');
    const loginTemplate = await seedTemplate(
      fixture.organization,
      fixture.root,
      fixture.viewId,
      'login_code',
    );
    await seedItem(fixture, loginTemplate, fixture.sourceId, { kind: 'login_code' });

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('never returns an expired reset, even if the purge has not run', async () => {
    const fixture = await seedFixture('rs-expired');
    await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId, {
      expiresAt: new Date('2026-11-03T12:04:59Z'),
    });

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return resets of another source that shares the template', async () => {
    const fixture = await seedFixture('rs-other-source');
    const otherSource = await seedSource(
      fixture.organization,
      fixture.root,
      'otra@rs-other-source.example',
    );
    await seedItem(fixture, fixture.resetTemplateId, otherSource);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return resets of a template outside the view', async () => {
    const fixture = await seedFixture('rs-outside');
    const loose = await seedTemplate(fixture.organization, fixture.root, null, 'reset_code');
    await seedItem(fixture, loose, fixture.sourceId);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return anything of an archived view', async () => {
    const fixture = await seedFixture('rs-archived');
    await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId);
    await db.admin.query('update mail_views set archived_at = now() where id = $1', [
      fixture.viewId,
    ]);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('honours the limit', async () => {
    const fixture = await seedFixture('rs-limit');
    await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId);
    await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId);

    await expect(list(fixture, 1)).resolves.toHaveLength(1);
  });

  it('does not return resets of another organization', async () => {
    const mine = await seedFixture('rs-mine');
    const theirs = await seedFixture('rs-theirs');
    await seedItem(theirs, theirs.resetTemplateId, theirs.sourceId);

    await expect(
      inOrg(mine.organization, () => store.listLiveResets(theirs.viewId, NOW, 20)),
    ).resolves.toEqual([]);
  });
});

describe('RevealInboundResets con auditoría y outbox reales', () => {
  const SECRET = '640082';

  /** Casos de uso reales; solo el autorizador es un doble porque el permiso no es lo que se prueba aquí. */
  function buildUseCase() {
    const auditEvents = new PgAuditEventRepository(uow);
    return new RevealInboundResets({
      context: requestContext,
      uow,
      authorizer: {
        require: () => Promise.resolve([]),
        auditDenial: () => Promise.resolve(),
      } as unknown as Authorizer,
      views: new PgInboundViewReader(uow),
      resets: store,
      cipher,
      audit: new RecordAuditEvent({ repository: auditEvents, context: requestContext, ids }),
      clock: { now: () => NOW },
    });
  }

  async function seedManagedView(slug: string, level: 'MANAGE' | 'EDIT' = 'MANAGE') {
    const fixture = await seedFixture(slug);
    await db.admin.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'user', $3, $4, $5)`,
      [fixture.organization, fixture.viewId, fixture.admin, level, fixture.root],
    );
    return fixture;
  }

  const revealAs = <T>(fixture: Fixture, fn: () => Promise<T>) =>
    requestContext.run(
      { ...contextFor(fixture.organization), actorId: asUserId(fixture.admin) },
      fn,
    );

  const auditRows = async (fixture: Fixture) =>
    (
      await db.admin.query<{ target_id: string; metadata: unknown }>(
        `select target_id, metadata from audit_events
          where organization_id = $1 and action = 'inbound.reset_revealed'`,
        [fixture.organization],
      )
    ).rows;

  const outboxRows = async (fixture: Fixture) =>
    (
      await db.admin.query<{ aggregate: string; payload: Record<string, unknown> }>(
        `select aggregate, payload from outbox_events
          where organization_id = $1 and type = 'inbound.reset_revealed'`,
        [fixture.organization],
      )
    ).rows;

  it('reveals, writes one audit per item each time and one notice per reveal, never the value', async () => {
    const fixture = await seedManagedView('rv-ok');
    const itemId = await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId, {
      value: SECRET,
    });
    const useCase = buildUseCase();

    const first = await revealAs(fixture, () => useCase.reveal(fixture.viewId, REASON));
    const second = await revealAs(fixture, () => useCase.reveal(fixture.viewId, REASON));

    expect(first.ok && first.value.map((item) => [item.itemId, item.value])).toEqual([
      [itemId, SECRET],
    ]);
    expect(second.ok).toBe(true);
    const audits = await auditRows(fixture);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toEqual({
      target_id: itemId,
      metadata: { sourceId: fixture.sourceId, viewId: fixture.viewId, reason: REASON },
    });
    const notices = await outboxRows(fixture);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toEqual({
      aggregate: 'mail_view',
      payload: {
        actorId: fixture.admin,
        viewId: fixture.viewId,
        revealedCount: 1,
        revealedAt: NOW.toISOString(),
      },
    });
    expect(JSON.stringify([audits, notices])).not.toContain(SECRET);
  });

  it('with EDIT on the view denies and leaves neither audit nor notice', async () => {
    const fixture = await seedManagedView('rv-edit', 'EDIT');
    await seedItem(fixture, fixture.resetTemplateId, fixture.sourceId, { value: SECRET });

    const result = await revealAs(fixture, () => buildUseCase().reveal(fixture.viewId, REASON));

    expect(!result.ok && result.error.code).toBe('AUTHZ.SHARE');
    expect(await auditRows(fixture)).toHaveLength(0);
    expect(await outboxRows(fixture)).toHaveLength(0);
  });

  it('without live resets audits the attempt on the view and sends no notice', async () => {
    const fixture = await seedManagedView('rv-empty');

    const result = await revealAs(fixture, () => buildUseCase().reveal(fixture.viewId, REASON));

    expect(result.ok && result.value).toEqual([]);
    expect(await auditRows(fixture)).toEqual([
      {
        target_id: fixture.viewId,
        metadata: { sourceId: fixture.sourceId, viewId: fixture.viewId, reason: REASON },
      },
    ]);
    expect(await outboxRows(fixture)).toHaveLength(0);
  });
});
