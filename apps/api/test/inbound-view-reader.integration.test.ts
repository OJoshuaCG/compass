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
  PgInboundViewReader,
  ReadInboundCodes,
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
 * Lectura de una vista de códigos entrantes con el rol de la aplicación (`iam_app`, sin BYPASSRLS):
 * ¿la consulta contiene todo lo que la regla de negocio exige? Cada caso responde una pregunta de
 * aislamiento: otra fuente que comparte plantilla, otra vista, otra organización, lo vencido, lo sensible.
 */

let db: TestDatabase;
let kekDir: string;
let uow: PgUnitOfWork;
let cipher: SecretCipher;
let reader: PgInboundViewReader;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const NOW = new Date('2026-11-02T12:05:00Z');
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly grantee: string;
  readonly sourceId: string;
  readonly viewId: string;
  readonly templateId: string;
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
  reader = new PgInboundViewReader(uow);
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

async function seedSource(
  organization: string,
  root: string,
  address: string,
  status: 'active' | 'suspended' | 'archived' = 'active',
): Promise<string> {
  return insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by, status, archived_at)
     values ($1, 'mail', $2, 'Buzón', $3, $4, case when $4 = 'archived' then now() else null end)
     returning id`,
    [organization, address, root, status],
  );
}

const seedView = (organization: string, sourceId: string, root: string, name = 'Vista') =>
  insertOne(
    `insert into mail_views (organization_id, source_id, name, created_by)
     values ($1, $2, $3, $4) returning id`,
    [organization, sourceId, name, root],
  );

async function seedTemplate(
  organization: string,
  root: string,
  viewId: string | null,
  kind: 'login_code' | 'reset_code' = 'login_code',
  archivedAt: Date | null = null,
): Promise<string> {
  const templateId = await insertOne(
    `insert into inbound_templates (organization_id, name, kind, definition, created_by, archived_at)
     values ($1, $2, $3, '{}'::jsonb, $4, $5) returning id`,
    [organization, `Plantilla ${ids.next()}`, kind, root, archivedAt],
  );
  if (viewId !== null) await linkTemplate(organization, viewId, templateId);
  return templateId;
}

async function linkTemplate(organization: string, viewId: string, templateId: string) {
  await db.admin.query(
    'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
    [organization, viewId, templateId],
  );
}

/** Organización con una fuente, una vista con una plantilla `login_code` y una persona sin compartición. */
async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const root = await insertOne(
    `insert into users (organization_id, email, display_name, rank)
     values ($1, $2, 'Raíz', 0) returning id`,
    [organization, `root-${slug}@example.test`],
  );
  const grantee = await insertOne(
    `insert into users (organization_id, email, display_name, rank, managed_by, status)
     values ($1, $2, 'Persona', 2, $3, 'active') returning id`,
    [organization, `persona-${slug}@example.test`, root],
  );
  const sourceId = await seedSource(organization, root, `codes@${slug}.example`);
  const viewId = await seedView(organization, sourceId, root);
  const templateId = await seedTemplate(organization, root, viewId);
  return { organization, root, grantee, sourceId, viewId, templateId };
}

interface ItemSeed {
  readonly kind?: 'login_code' | 'reset_code';
  readonly visibility?: 'visible_with_use' | 'sensitive';
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
  const sealed = await inOrg(fixture.organization, () =>
    cipher.encrypt(
      inboundItemContext(asOrganizationId(fixture.organization), itemId),
      text(seed.value ?? '123456'),
    ),
  );
  if (!sealed.ok) throw new Error(sealed.error.code);
  await db.admin.query(
    `insert into inbound_items
       (id, organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce,
        dek_version, expires_at, created_at)
     values ($1, $2, $3, $4, $5, 'code', $6, $7, $8, $9, $10, $11)`,
    [
      itemId,
      fixture.organization,
      sourceId,
      templateId,
      seed.kind ?? 'login_code',
      seed.visibility ?? 'visible_with_use',
      Buffer.from(sealed.value.ciphertext),
      Buffer.from(sealed.value.nonce),
      sealed.value.dekVersion,
      seed.expiresAt ?? new Date('2026-11-02T12:10:00Z'),
      seed.createdAt ?? new Date('2026-11-02T12:00:00Z'),
    ],
  );
  return itemId;
}

async function seedReceipt(
  fixture: Fixture,
  sourceId: string,
  templateId: string | null,
  receivedAt: string,
  outcome: 'accepted' | 'quarantined' = 'accepted',
): Promise<string> {
  return insertOne(
    `insert into inbound_receipts
       (organization_id, source_id, message_fingerprint, outcome, reason, template_id, template_kind, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      fixture.organization,
      sourceId,
      `fp-${ids.next()}`,
      outcome,
      outcome === 'quarantined' ? 'DKIM_FAILED' : null,
      outcome === 'accepted' ? templateId : null,
      outcome === 'accepted' ? 'login_code' : null,
      receivedAt,
    ],
  );
}

describe('PgInboundViewReader.findLiveView', () => {
  it('finds a live view of an active source', async () => {
    const fixture = await seedFixture('flv-live');

    const view = await inOrg(fixture.organization, () => reader.findLiveView(fixture.viewId));

    expect(view).toEqual({ id: fixture.viewId, sourceId: fixture.sourceId });
  });

  it('does not find an archived view', async () => {
    const fixture = await seedFixture('flv-archived-view');
    await db.admin.query('update mail_views set archived_at = now() where id = $1', [
      fixture.viewId,
    ]);

    await expect(
      inOrg(fixture.organization, () => reader.findLiveView(fixture.viewId)),
    ).resolves.toBeNull();
  });

  it.each(['suspended', 'archived'] as const)(
    'does not find a view of a %s source',
    async (status) => {
      const organization = await db.seedOrganization(`flv-${status}`);
      const root = await insertOne(
        `insert into users (organization_id, email, display_name, rank)
       values ($1, $2, 'Raíz', 0) returning id`,
        [organization, `root-${status}@example.test`],
      );
      const sourceId = await seedSource(organization, root, `codes@${status}.example`, status);
      const viewId = await seedView(organization, sourceId, root);

      await expect(inOrg(organization, () => reader.findLiveView(viewId))).resolves.toBeNull();
    },
  );

  it('does not find the view of another organization', async () => {
    const mine = await seedFixture('flv-mine');
    const theirs = await seedFixture('flv-theirs');

    await expect(
      inOrg(mine.organization, () => reader.findLiveView(theirs.viewId)),
    ).resolves.toBeNull();
  });
});

describe('PgInboundViewReader.effectiveLevel', () => {
  /** Compartición directa de nivel VIEW; el vencimiento es opcional (`null` = sin vencimiento). */
  const share = (fixture: Fixture, expiresAt: Date | null = null) =>
    db.admin.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by, expires_at)
       values ($1, 'mail_view', $2, 'user', $3, 'VIEW', $4, $5)`,
      [fixture.organization, fixture.viewId, fixture.grantee, fixture.root, expiresAt],
    );

  it('is null without a share', async () => {
    const fixture = await seedFixture('lvl-none');

    await expect(
      inOrg(fixture.organization, () =>
        reader.effectiveLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).resolves.toBeNull();
  });

  it('returns the level of a live direct share', async () => {
    const fixture = await seedFixture('lvl-direct');
    await share(fixture);

    await expect(
      inOrg(fixture.organization, () =>
        reader.effectiveLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).resolves.toBe('VIEW');
  });

  it('is null once the share expired', async () => {
    const fixture = await seedFixture('lvl-expired');
    await share(fixture, new Date(Date.now() - 60_000));

    await expect(
      inOrg(fixture.organization, () =>
        reader.effectiveLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).resolves.toBeNull();
  });

  it('is null once the share was revoked', async () => {
    const fixture = await seedFixture('lvl-revoked');
    await share(fixture);
    await db.admin.query(
      'update shares set revoked_at = now(), revoked_by = $1 where resource_id = $2',
      [fixture.root, fixture.viewId],
    );

    await expect(
      inOrg(fixture.organization, () =>
        reader.effectiveLevel(fixture.viewId, asUserId(fixture.grantee)),
      ),
    ).resolves.toBeNull();
  });
});

describe('PgInboundViewReader.listLiveLoginCodes', () => {
  const list = (fixture: Fixture, limit = 20) =>
    inOrg(fixture.organization, () => reader.listLiveLoginCodes(fixture.viewId, NOW, limit));

  it('returns a live login code that opens with the item context', async () => {
    const fixture = await seedFixture('codes-live');
    const itemId = await seedItem(fixture, fixture.templateId, fixture.sourceId, {
      value: '654321',
    });

    const [record, ...rest] = await list(fixture);

    expect(rest).toEqual([]);
    expect(record?.itemId).toBe(itemId);
    const opened = await inOrg(fixture.organization, () =>
      cipher.decrypt(inboundItemContext(asOrganizationId(fixture.organization), itemId), {
        ciphertext: record?.ciphertext ?? new Uint8Array(),
        nonce: record?.nonce ?? new Uint8Array(),
        dekVersion: record?.dekVersion ?? 0,
      }),
    );
    expect(opened.ok && new TextDecoder().decode(opened.value)).toBe('654321');
  });

  it('never returns an expired item, even if the purge has not run', async () => {
    const fixture = await seedFixture('codes-expired');
    await seedItem(fixture, fixture.templateId, fixture.sourceId, {
      expiresAt: new Date('2026-11-02T12:04:00Z'),
    });
    // El instante exacto de vencimiento también está vencido.
    await seedItem(fixture, fixture.templateId, fixture.sourceId, { expiresAt: NOW });

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('never returns a reset, whatever its visibility column says', async () => {
    const fixture = await seedFixture('codes-reset');
    const resetTemplate = await seedTemplate(
      fixture.organization,
      fixture.root,
      fixture.viewId,
      'reset_code',
    );
    await seedItem(fixture, resetTemplate, fixture.sourceId, {
      kind: 'reset_code',
      visibility: 'sensitive',
    });

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return items of a template that is not in the view', async () => {
    const fixture = await seedFixture('codes-other-template');
    const outsideTemplate = await seedTemplate(fixture.organization, fixture.root, null);
    await seedItem(fixture, outsideTemplate, fixture.sourceId);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return items of another source that shares the template', async () => {
    const fixture = await seedFixture('codes-shared-template');
    const otherSource = await seedSource(
      fixture.organization,
      fixture.root,
      'otra@codes-shared.example',
    );
    const otherView = await seedView(fixture.organization, otherSource, fixture.root);
    await linkTemplate(fixture.organization, otherView, fixture.templateId);
    await seedItem(fixture, fixture.templateId, otherSource);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('does not return items of an archived template', async () => {
    const fixture = await seedFixture('codes-archived-template');
    await db.admin.query('update inbound_templates set archived_at = now() where id = $1', [
      fixture.templateId,
    ]);
    await seedItem(fixture, fixture.templateId, fixture.sourceId);

    await expect(list(fixture)).resolves.toEqual([]);
  });

  it('returns the newest first and honours the limit', async () => {
    const fixture = await seedFixture('codes-order');
    const older = await seedItem(fixture, fixture.templateId, fixture.sourceId, {
      createdAt: new Date('2026-11-02T12:01:00Z'),
    });
    const newer = await seedItem(fixture, fixture.templateId, fixture.sourceId, {
      createdAt: new Date('2026-11-02T12:03:00Z'),
    });

    expect((await list(fixture)).map((record) => record.itemId)).toEqual([newer, older]);
    expect((await list(fixture, 1)).map((record) => record.itemId)).toEqual([newer]);
  });

  it('does not return items of another organization', async () => {
    const mine = await seedFixture('codes-org-mine');
    const theirs = await seedFixture('codes-org-theirs');
    await seedItem(theirs, theirs.templateId, theirs.sourceId);

    await expect(
      inOrg(mine.organization, () => reader.listLiveLoginCodes(theirs.viewId, NOW, 20)),
    ).resolves.toEqual([]);
  });
});

describe('PgInboundViewReader.listHistory', () => {
  const history = (
    fixture: Fixture,
    limit = 10,
    after = null as null | { receivedAt: Date; id: string },
  ) => inOrg(fixture.organization, () => reader.listHistory(fixture.viewId, { limit, after }));

  it('lists accepted receipts of the view and never the quarantine', async () => {
    const fixture = await seedFixture('hist-basic');
    const accepted = await seedReceipt(
      fixture,
      fixture.sourceId,
      fixture.templateId,
      '2026-11-02T12:00:00Z',
    );
    await seedReceipt(fixture, fixture.sourceId, null, '2026-11-02T12:01:00Z', 'quarantined');

    const rows = await history(fixture);

    expect(rows.map((row) => row.receiptId)).toEqual([accepted]);
    expect(rows[0]).toMatchObject({ templateKind: 'login_code' });
  });

  it('keeps a receipt after its item was purged', async () => {
    const fixture = await seedFixture('hist-purged');
    const itemId = await seedItem(fixture, fixture.templateId, fixture.sourceId);
    const receipt = await insertOne(
      `insert into inbound_receipts
         (organization_id, source_id, message_fingerprint, outcome, template_id, template_kind, item_id, received_at)
       values ($1, $2, 'fp-purged', 'accepted', $3, 'login_code', $4, '2026-11-02T12:00:00Z') returning id`,
      [fixture.organization, fixture.sourceId, fixture.templateId, itemId],
    );
    await db.admin.query('delete from inbound_items where id = $1', [itemId]);

    expect((await history(fixture)).map((row) => row.receiptId)).toEqual([receipt]);
  });

  it('does not list receipts of another source that shares the template', async () => {
    const fixture = await seedFixture('hist-shared-template');
    const otherSource = await seedSource(
      fixture.organization,
      fixture.root,
      'otra@hist-shared.example',
    );
    const otherView = await seedView(fixture.organization, otherSource, fixture.root);
    await linkTemplate(fixture.organization, otherView, fixture.templateId);
    await seedReceipt(fixture, otherSource, fixture.templateId, '2026-11-02T12:00:00Z');

    await expect(history(fixture)).resolves.toEqual([]);
  });

  it('does not list receipts of a template outside the view or without template', async () => {
    const fixture = await seedFixture('hist-outside');
    const outsideTemplate = await seedTemplate(fixture.organization, fixture.root, null);
    await seedReceipt(fixture, fixture.sourceId, outsideTemplate, '2026-11-02T12:00:00Z');
    await db.admin.query(
      `insert into inbound_receipts
         (organization_id, source_id, message_fingerprint, outcome, template_kind, received_at)
       values ($1, $2, 'fp-legacy', 'accepted', 'login_code', '2026-11-02T12:00:00Z')`,
      [fixture.organization, fixture.sourceId],
    );

    await expect(history(fixture)).resolves.toEqual([]);
  });

  it('pages newest first without repeating or skipping, even with equal timestamps', async () => {
    const fixture = await seedFixture('hist-paging');
    const created: string[] = [];
    for (const receivedAt of [
      '2026-11-02T12:00:00Z',
      '2026-11-02T12:02:00Z',
      '2026-11-02T12:02:00Z',
      '2026-11-02T12:03:00Z',
      '2026-11-02T12:04:00Z',
    ]) {
      created.push(await seedReceipt(fixture, fixture.sourceId, fixture.templateId, receivedAt));
    }

    const seen: string[] = [];
    let after: { receivedAt: Date; id: string } | null = null;
    for (let page = 0; page < 5; page += 1) {
      const rows = await history(fixture, 2, after);
      seen.push(...rows.map((row) => row.receiptId));
      const last = rows.at(-1);
      if (rows.length < 2 || last === undefined) break;
      after = { receivedAt: last.receivedAt, id: last.receiptId };
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(created));
    const times = await db.admin.query<{ received_at: Date }>(
      'select received_at from inbound_receipts where id = any($1::uuid[]) order by array_position($1::uuid[], id)',
      [seen],
    );
    const ordered = times.rows.map((row) => row.received_at.getTime());
    expect(ordered).toEqual([...ordered].sort((left, right) => right - left));
  });
});

describe('PgInboundViewReader.lockItemRead', () => {
  it('takes the lock inside the transaction without failing', async () => {
    const fixture = await seedFixture('lock-basic');

    await expect(
      inOrg(fixture.organization, () => reader.lockItemRead(asUserId(fixture.grantee), ids.next())),
    ).resolves.toBeUndefined();
  });
});

describe('ReadInboundCodes con auditoría real', () => {
  const SECRET = '907413';

  /** Casos de uso reales; solo el autorizador es un doble porque el permiso no es lo que se prueba aquí. */
  function buildUseCase() {
    const auditEvents = new PgAuditEventRepository(uow);
    return new ReadInboundCodes({
      context: requestContext,
      uow,
      authorizer: {
        require: () => Promise.resolve([]),
        auditDenial: () => Promise.resolve(),
      } as unknown as Authorizer,
      views: reader,
      cipher,
      audit: new RecordAuditEvent({ repository: auditEvents, context: requestContext, ids }),
      auditCounter: auditEvents,
      clock: { now: () => NOW },
    });
  }

  async function seedReadableView(slug: string) {
    const fixture = await seedFixture(slug);
    await db.admin.query(
      `insert into shares
         (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       values ($1, 'mail_view', $2, 'user', $3, 'USE', $4)`,
      [fixture.organization, fixture.viewId, fixture.grantee, fixture.root],
    );
    return fixture;
  }

  const readAs = <T>(fixture: Fixture, fn: () => Promise<T>) =>
    requestContext.run(
      { ...contextFor(fixture.organization), actorId: asUserId(fixture.grantee) },
      fn,
    );

  const countReads = async (fixture: Fixture): Promise<number> => {
    const result = await db.admin.query<{ total: string }>(
      `select count(*)::text as total from audit_events
        where organization_id = $1 and action = 'inbound.code_read'`,
      [fixture.organization],
    );
    return Number(result.rows[0]?.total);
  };

  it('delivers the code and writes exactly one audit event per person and item', async () => {
    const fixture = await seedReadableView('e2e-once');
    const itemId = await seedItem(fixture, fixture.templateId, fixture.sourceId, { value: SECRET });
    const useCase = buildUseCase();

    const first = await readAs(fixture, () => useCase.listCodes(fixture.viewId));
    const refresh = await readAs(fixture, () => useCase.listCodes(fixture.viewId));

    expect(first.ok && first.value.map((code) => [code.itemId, code.code])).toEqual([
      [itemId, SECRET],
    ]);
    expect(refresh.ok).toBe(true);
    expect(await countReads(fixture)).toBe(1);
    const stored = await db.admin.query<{ metadata: unknown }>(
      "select metadata from audit_events where organization_id = $1 and action = 'inbound.code_read'",
      [fixture.organization],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(SECRET);
  });

  it('keeps one audit event and avoids deadlocks under concurrent reads', async () => {
    const fixture = await seedReadableView('e2e-concurrent');
    await seedItem(fixture, fixture.templateId, fixture.sourceId, { value: SECRET });
    await seedItem(fixture, fixture.templateId, fixture.sourceId, { value: SECRET });
    const useCase = buildUseCase();

    const results = await Promise.all(
      [1, 2, 3, 4].map(() => readAs(fixture, () => useCase.listCodes(fixture.viewId))),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(await countReads(fixture)).toBe(2);
  });

  it('does not audit a read when the person has no access', async () => {
    const fixture = await seedFixture('e2e-denied');
    await seedItem(fixture, fixture.templateId, fixture.sourceId, { value: SECRET });

    const result = await readAs(fixture, () => buildUseCase().listCodes(fixture.viewId));

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(await countReads(fixture)).toBe(0);
  });
});
