import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import {
  PgInboundRecorder,
  PgMailConnectionLoader,
  PgPollableSourceLister,
  PgPollStateStore,
  PgSourceTemplateStore,
  ReadOnlyDataKeyRepository,
  Sha256MessageFingerprinter,
  inboundItemContext,
  mailSourcePasswordContext,
} from '../src/modules/inbound-codes/index.js';
import type { AcceptedRecord, SourceRef } from '../src/modules/inbound-codes/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import type { OrganizationId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase, openInboundWorkerPool } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Adaptadores `pg` del sondeo IMAP, ejecutados con el rol `iam_inbound_worker` (sin BYPASSRLS y con
 * permisos de columna acotados), que es el que usará el proceso real. Las preguntas que responde:
 * ¿el rol alcanza para todo lo que el sondeo hace?, ¿el aislamiento por filas lo contiene?, ¿la
 * deduplicación deja huérfanos?
 */

let db: TestDatabase;
let workerPool: Pool;
let kekDir: string;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

// El lado de la API crea las DEK; el del worker solo las lee.
let appCipher: SecretCipher;
let appUow: PgUnitOfWork;
let workerCipher: SecretCipher;
let pollState: PgPollStateStore;
let recorder: PgInboundRecorder;
let templates: PgSourceTemplateStore;
let connections: PgMailConnectionLoader;
const fingerprinter = new Sha256MessageFingerprinter();

interface SeededSource {
  readonly organization: OrganizationId;
  readonly sourceId: string;
  readonly ref: SourceRef;
  readonly templateId: string;
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const inAppOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => appUow.run(fn));

const TEMPLATE_DEFINITION = {
  senderAddress: 'no-reply@vendor.example',
  subject: { mode: 'prefix', value: 'Tu código' },
  extraction: {
    type: 'fixed_length_code',
    leadingLiteral: 'Código: ',
    codeLength: 6,
    charset: 'digits',
    trailingLiteral: '',
  },
};

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  workerPool = openInboundWorkerPool(db);
  kekDir = mkdtempSync(join(tmpdir(), 'iam-kek-'));
  const clock = new SystemClock();
  const kms = new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' });

  appUow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  appCipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new PgDataKeyRepository(appUow),
      kms,
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => appUow.run(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });

  const workerUow = new PgUnitOfWork(workerPool, requestContext, workerPool);
  workerCipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new ReadOnlyDataKeyRepository(workerUow),
      kms,
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => workerUow.runIndependent(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });
  const scope = new PgTenantScope(requestContext, workerUow);
  pollState = new PgPollStateStore(scope, workerUow, ids);
  recorder = new PgInboundRecorder(scope, workerUow, workerCipher, ids);
  templates = new PgSourceTemplateStore(scope, workerUow, ids);
  connections = new PgMailConnectionLoader(scope, workerUow, workerCipher, ids);
});

afterAll(async () => {
  await workerPool.end();
  await db.close();
  rmSync(kekDir, { recursive: true, force: true });
});

/** `seedOrganization` no crea usuarios: el primero de la organización es la Raíz (rango 0). */
async function rootUserOf(organization: string): Promise<string> {
  const existing = await db.admin.query<{ id: string }>(
    'select id from users where organization_id = $1 and rank = 0 limit 1',
    [organization],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId !== undefined) return existingId;
  const created = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank)
     values ($1, $2, 'Raíz', 0) returning id`,
    [organization, `root-${organization}@example.test`],
  );
  const id = created.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed: root user');
  return id;
}

/**
 * Siembra una organización con su fuente de correo, conexión (contraseña cifrada con la DEK que crea la
 * API), vista y plantilla. `withKey: false` deja a la organización sin DEK para probar el tope del worker.
 */
async function seedSource(
  slug: string,
  options: { readonly withKey?: boolean; readonly password?: string | null } = {},
): Promise<SeededSource> {
  const { withKey = true, password = 'imap-secret' } = options;
  const organization = asOrganizationId(await db.seedOrganization(slug));
  const creator = await rootUserOf(organization);
  const address = `codes@${slug}.example`;

  const source = await db.admin.query<{ id: string }>(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by)
     values ($1, 'mail', $2, 'Buzón', $3) returning id`,
    [organization, address, creator],
  );
  const sourceId = source.rows[0]?.id;
  if (sourceId === undefined) throw new Error('seed failed: source');

  let ciphertext: Buffer | null = null;
  let nonce: Buffer | null = null;
  let dekVersion: number | null = null;
  if (withKey && password !== null) {
    const sealed = await inAppOrg(organization, () =>
      appCipher.encrypt(mailSourcePasswordContext(organization, sourceId, 1), text(password)),
    );
    if (!sealed.ok) throw new Error(sealed.error.code);
    ciphertext = Buffer.from(sealed.value.ciphertext);
    nonce = Buffer.from(sealed.value.nonce);
    dekVersion = sealed.value.dekVersion;
  } else if (withKey) {
    // Una DEK existente sin contraseña guardada: la crea un cifrado cualquiera de la API.
    await inAppOrg(organization, () =>
      appCipher.encrypt(inboundItemContext(organization, sourceId), text('x')),
    );
  }
  await db.admin.query(
    `insert into mail_source_connections
       (organization_id, source_id, host, port, username, tls_mode, authserv_id, accepted_recipients,
        password_ciphertext, password_nonce, dek_version, created_by)
     values ($1, $2, 'imap.example.test', 993, 'codes', 'tls', 'mx.example.test', array[$3::text], $4, $5, $6, $7)`,
    [organization, sourceId, address, ciphertext, nonce, dekVersion, creator],
  );

  const view = await db.admin.query<{ id: string }>(
    `insert into mail_views (organization_id, source_id, name, created_by)
     values ($1, $2, 'Vista', $3) returning id`,
    [organization, sourceId, creator],
  );
  const viewId = view.rows[0]?.id;
  if (viewId === undefined) throw new Error('seed failed: view');
  const templateId = await seedTemplate(organization, creator, viewId, TEMPLATE_DEFINITION);

  return { organization, sourceId, ref: { organizationId: organization, sourceId }, templateId };
}

async function seedTemplate(
  organization: string,
  creator: string,
  viewId: string,
  definition: unknown,
  archivedAt: Date | null = null,
): Promise<string> {
  const template = await db.admin.query<{ id: string }>(
    `insert into inbound_templates (organization_id, name, kind, definition, created_by, archived_at)
     values ($1, $2, 'login_code', $3::jsonb, $4, $5) returning id`,
    [organization, `Plantilla ${ids.next()}`, JSON.stringify(definition), creator, archivedAt],
  );
  const templateId = template.rows[0]?.id;
  if (templateId === undefined) throw new Error('seed failed: template');
  await db.admin.query(
    'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
    [organization, viewId, templateId],
  );
  return templateId;
}

function accepted(source: SeededSource, fingerprint: string, value = '123456'): AcceptedRecord {
  return {
    fingerprint,
    receivedAt: new Date('2026-11-02T12:00:00Z'),
    templateId: source.templateId,
    kind: 'login_code',
    visibility: 'visible_with_use',
    valueType: 'code',
    value,
    expiresAt: new Date('2026-11-02T12:10:00Z'),
    signingDomain: 'vendor.example',
  };
}

async function count(table: string, source: SeededSource): Promise<number> {
  const row = await db.admin.query<{ total: string }>(
    `select count(*) as total from ${table} where organization_id = $1 and source_id = $2`,
    [source.organization, source.sourceId],
  );
  return Number(row.rows[0]?.total ?? 0);
}

describe('PgPollStateStore', () => {
  it('claims a fresh source, excludes a second claimer and lets an expired lease be taken', async () => {
    const source = await seedSource('poll-claim');
    const now = new Date('2026-11-02T10:00:00Z');

    const first = await pollState.claim(source.ref, now, 90_000);
    expect(first).toEqual({ uidValidity: null, lastUid: 0, consecutiveFailures: 0 });

    const second = await pollState.claim(source.ref, new Date(now.getTime() + 10_000), 90_000);
    expect(second).toBeNull();

    const afterExpiry = await pollState.claim(source.ref, new Date(now.getTime() + 91_000), 90_000);
    expect(afterExpiry).not.toBeNull();
  });

  it('lets only one of several concurrent claimers win', async () => {
    const source = await seedSource('poll-race');
    const now = new Date('2026-11-02T10:00:00Z');

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => pollState.claim(source.ref, now, 90_000)),
    );

    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
  });

  it('saves the cursor and keeps the lease until it is released', async () => {
    const source = await seedSource('poll-cursor');
    const now = new Date('2026-11-02T10:00:00Z');
    await pollState.claim(source.ref, now, 90_000);

    await pollState.saveCursor(source.ref, { uidValidity: 4_000_000_000, lastUid: 42 });
    expect(await pollState.claim(source.ref, now, 90_000)).toBeNull();

    await pollState.releaseAfterSuccess(source.ref, now);
    expect(await pollState.claim(source.ref, now, 90_000)).toEqual({
      uidValidity: 4_000_000_000,
      lastUid: 42,
      consecutiveFailures: 0,
    });
  });

  it('counts a failure with its bounded code and resets it after a success', async () => {
    const source = await seedSource('poll-failure');
    const now = new Date('2026-11-02T10:00:00Z');
    const retryAt = new Date('2026-11-02T10:05:00Z');

    await pollState.claim(source.ref, now, 90_000);
    await pollState.releaseAfterFailure(
      source.ref,
      { errorCode: 'NETWORK', nextAttemptAt: retryAt },
      now,
    );

    const failed = await db.admin.query<{
      consecutive_failures: number;
      last_error_code: string;
      next_attempt_at: Date;
      claimed_until: Date | null;
    }>(
      'select consecutive_failures, last_error_code, next_attempt_at, claimed_until from mail_source_poll_state where source_id = $1',
      [source.sourceId],
    );
    expect(failed.rows[0]).toMatchObject({
      consecutive_failures: 1,
      last_error_code: 'NETWORK',
      claimed_until: null,
    });
    expect(failed.rows[0]?.next_attempt_at.toISOString()).toBe(retryAt.toISOString());

    await pollState.claim(source.ref, retryAt, 90_000);
    await pollState.releaseAfterSuccess(source.ref, retryAt);
    const recovered = await db.admin.query<{
      consecutive_failures: number;
      last_error_code: string | null;
    }>(
      'select consecutive_failures, last_error_code from mail_source_poll_state where source_id = $1',
      [source.sourceId],
    );
    expect(recovered.rows[0]).toEqual({ consecutive_failures: 0, last_error_code: null });
  });
});

describe('PgPollStateStore lease ownership and backoff', () => {
  /** Segunda instancia del almacén: representa a otro proceso del worker sobre la misma base. */
  function otherWorker(): PgPollStateStore {
    const workerUow = new PgUnitOfWork(workerPool, requestContext, workerPool);
    return new PgPollStateStore(new PgTenantScope(requestContext, workerUow), workerUow, ids);
  }

  it('does not let a pass that outlived its lease move the cursor or free the lease of the new holder', async () => {
    const source = await seedSource('poll-stale');
    const staleHolder = otherWorker();
    const newHolder = otherWorker();
    const start = new Date('2026-11-02T10:00:00Z');

    await staleHolder.claim(source.ref, start, 90_000);
    // El arrendamiento del primero venció y otro proceso tomó la fuente.
    const takeover = new Date(start.getTime() + 120_000);
    await newHolder.claim(source.ref, takeover, 90_000);
    await newHolder.saveCursor(source.ref, { uidValidity: 7, lastUid: 50 });

    await staleHolder.saveCursor(source.ref, { uidValidity: 7, lastUid: 10 });
    await staleHolder.releaseAfterFailure(
      source.ref,
      { errorCode: 'NETWORK', nextAttemptAt: new Date(takeover.getTime() + 60_000) },
      takeover,
    );

    const row = await db.admin.query<{
      last_uid: string;
      claimed_until: Date | null;
      consecutive_failures: number;
    }>(
      'select last_uid, claimed_until, consecutive_failures from mail_source_poll_state where source_id = $1',
      [source.sourceId],
    );
    expect(row.rows[0]?.last_uid).toBe('50');
    expect(row.rows[0]?.claimed_until).not.toBeNull();
    expect(row.rows[0]?.consecutive_failures).toBe(0);
  });

  it('does nothing when it releases or saves without having claimed', async () => {
    const source = await seedSource('poll-noclaim');
    const worker = otherWorker();
    const now = new Date('2026-11-02T10:00:00Z');
    await pollState.claim(source.ref, now, 90_000);

    await worker.saveCursor(source.ref, { uidValidity: 1, lastUid: 99 });
    await worker.releaseAfterSuccess(source.ref, now);

    const row = await db.admin.query<{ last_uid: string; claimed_until: Date | null }>(
      'select last_uid, claimed_until from mail_source_poll_state where source_id = $1',
      [source.sourceId],
    );
    expect(row.rows[0]?.last_uid).toBe('0');
    expect(row.rows[0]?.claimed_until).not.toBeNull();
  });

  it('does not claim a source whose backoff has not elapsed, even if it was listed earlier', async () => {
    const source = await seedSource('poll-backoff');
    const now = new Date('2026-11-02T10:00:00Z');
    const retryAt = new Date('2026-11-02T10:10:00Z');
    await pollState.claim(source.ref, now, 90_000);
    await pollState.releaseAfterFailure(
      source.ref,
      { errorCode: 'NETWORK', nextAttemptAt: retryAt },
      now,
    );

    expect(await pollState.claim(source.ref, new Date('2026-11-02T10:05:00Z'), 90_000)).toBeNull();
    expect(await pollState.claim(source.ref, retryAt, 90_000)).not.toBeNull();
  });
});

describe('PgInboundRecorder', () => {
  it('stores the value encrypted, links the receipt to the item and never keeps the plaintext', async () => {
    const source = await seedSource('rec-accepted');
    const fingerprint = fingerprinter.forRawMessage(source.sourceId, text('mensaje uno'));

    expect(await recorder.hasReceipt(source.ref, fingerprint)).toBe(false);
    expect(await recorder.recordAccepted(source.ref, accepted(source, fingerprint, '987654'))).toBe(
      'recorded',
    );
    expect(await recorder.hasReceipt(source.ref, fingerprint)).toBe(true);

    const item = await db.admin.query<{
      id: string;
      ciphertext: Buffer;
      nonce: Buffer;
      dek_version: number;
    }>(
      'select id, ciphertext, nonce, dek_version from inbound_items where organization_id = $1 and source_id = $2',
      [source.organization, source.sourceId],
    );
    const stored = item.rows[0];
    if (stored === undefined) throw new Error('no item stored');
    expect(Buffer.from(stored.ciphertext).includes(Buffer.from('987654'))).toBe(false);

    const opened = await inAppOrg(source.organization, () =>
      appCipher.decrypt(inboundItemContext(source.organization, stored.id), {
        ciphertext: new Uint8Array(stored.ciphertext),
        nonce: new Uint8Array(stored.nonce),
        dekVersion: stored.dek_version,
      }),
    );
    if (!opened.ok) throw new Error(opened.error.code);
    expect(read(opened.value)).toBe('987654');

    const receipt = await db.admin.query<{
      outcome: string;
      item_id: string;
      signing_domain: string;
      template_kind: string;
    }>(
      'select outcome, item_id, signing_domain, template_kind from inbound_receipts where organization_id = $1 and source_id = $2',
      [source.organization, source.sourceId],
    );
    expect(receipt.rows[0]).toEqual({
      outcome: 'accepted',
      item_id: stored.id,
      signing_domain: 'vendor.example',
      template_kind: 'login_code',
    });
  });

  it('reports a duplicate and leaves no orphan item when the receipt already exists', async () => {
    const source = await seedSource('rec-duplicate');
    const fingerprint = fingerprinter.forRawMessage(source.sourceId, text('mensaje repetido'));

    expect(await recorder.recordAccepted(source.ref, accepted(source, fingerprint))).toBe(
      'recorded',
    );
    expect(await recorder.recordAccepted(source.ref, accepted(source, fingerprint))).toBe(
      'duplicate',
    );

    expect(await count('inbound_items', source)).toBe(1);
    expect(await count('inbound_receipts', source)).toBe(1);
  });

  it('keeps only one item when the same message is recorded concurrently', async () => {
    const source = await seedSource('rec-concurrent');
    const fingerprint = fingerprinter.forRawMessage(source.sourceId, text('mensaje en carrera'));

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        recorder.recordAccepted(source.ref, accepted(source, fingerprint)),
      ),
    );

    expect(outcomes.filter((outcome) => outcome === 'recorded')).toHaveLength(1);
    expect(await count('inbound_items', source)).toBe(1);
    expect(await count('inbound_receipts', source)).toBe(1);
  });

  it('records a quarantine receipt without an item and treats a repeat as a duplicate', async () => {
    const source = await seedSource('rec-quarantine');
    const fingerprint = fingerprinter.forMailboxPosition(source.sourceId, 7, 11);
    const record = {
      fingerprint,
      receivedAt: new Date('2026-11-02T12:00:00Z'),
      reason: 'NO_MATCHING_TEMPLATE' as const,
    };

    expect(await recorder.recordQuarantine(source.ref, record)).toBe('recorded');
    expect(await recorder.recordQuarantine(source.ref, record)).toBe('duplicate');

    const receipt = await db.admin.query<{
      outcome: string;
      reason: string;
      item_id: string | null;
    }>(
      'select outcome, reason, item_id from inbound_receipts where organization_id = $1 and source_id = $2',
      [source.organization, source.sourceId],
    );
    expect(receipt.rows).toEqual([
      { outcome: 'quarantined', reason: 'NO_MATCHING_TEMPLATE', item_id: null },
    ]);
    expect(await count('inbound_items', source)).toBe(0);
  });

  it('refuses to create a data key: an organization without one fails and stores nothing', async () => {
    const source = await seedSource('rec-nokey', { withKey: false });
    const fingerprint = fingerprinter.forRawMessage(source.sourceId, text('sin llave'));

    await expect(
      recorder.recordAccepted(source.ref, accepted(source, fingerprint)),
    ).rejects.toThrow();

    expect(await count('inbound_items', source)).toBe(0);
    expect(await count('inbound_receipts', source)).toBe(0);
    const keys = await db.admin.query('select 1 from data_keys where organization_id = $1', [
      source.organization,
    ]);
    expect(keys.rowCount).toBe(0);
  });

  it('cannot write into another organization even when asked to', async () => {
    const own = await seedSource('rec-iso-a');
    const other = await seedSource('rec-iso-b');
    const forged: SourceRef = { organizationId: own.organization, sourceId: other.sourceId };

    await expect(
      recorder.recordAccepted(
        forged,
        accepted(other, fingerprinter.forRawMessage(other.sourceId, text('x'))),
      ),
    ).rejects.toThrow();

    expect(await count('inbound_items', other)).toBe(0);
    expect(await count('inbound_receipts', other)).toBe(0);
  });
});

describe('PgSourceTemplateStore', () => {
  it('lists only live templates of live views, parsed from their definition', async () => {
    const source = await seedSource('tpl-live');
    const creator = await rootUserOf(source.organization);
    const view = await db.admin.query<{ id: string }>(
      'select id from mail_views where organization_id = $1 and source_id = $2',
      [source.organization, source.sourceId],
    );
    const viewId = view.rows[0]?.id ?? '';
    await seedTemplate(source.organization, creator, viewId, TEMPLATE_DEFINITION, new Date());

    const listed = await templates.listForSource(source.ref);

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual({
      id: source.templateId,
      kind: 'login_code',
      ...TEMPLATE_DEFINITION,
    });
  });

  it('ignores templates whose view is archived and templates with an unreadable definition', async () => {
    const source = await seedSource('tpl-closed');
    const creator = await rootUserOf(source.organization);
    const view = await db.admin.query<{ id: string }>(
      'select id from mail_views where organization_id = $1 and source_id = $2',
      [source.organization, source.sourceId],
    );
    const viewId = view.rows[0]?.id ?? '';
    await seedTemplate(source.organization, creator, viewId, { senderAddress: 5 });
    await seedTemplate(source.organization, creator, viewId, {
      ...TEMPLATE_DEFINITION,
      extraction: {
        type: 'fixed_length_code',
        leadingLiteral: '',
        codeLength: 4,
        charset: 'digits',
        trailingLiteral: '',
      },
    });
    expect((await templates.listForSource(source.ref)).map((template) => template.id)).toEqual([
      source.templateId,
    ]);

    await db.admin.query('update mail_views set archived_at = now() where id = $1', [viewId]);
    expect(await templates.listForSource(source.ref)).toEqual([]);
  });

  it('does not leak the templates of another organization', async () => {
    const own = await seedSource('tpl-iso-a');
    const other = await seedSource('tpl-iso-b');

    const listed = await templates.listForSource({
      organizationId: own.organization,
      sourceId: other.sourceId,
    });

    expect(listed).toEqual([]);
  });
});

describe('PgMailConnectionLoader', () => {
  it('opens the stored password with the data key the API created', async () => {
    const source = await seedSource('conn-ok', { password: 'pa$$word-üñí' });

    const loaded = await connections.load(source.ref);

    expect(loaded).toEqual({
      ok: true,
      connection: {
        host: 'imap.example.test',
        port: 993,
        username: 'codes',
        password: 'pa$$word-üñí',
        tlsMode: 'tls',
        authservId: 'mx.example.test',
        sourceAddress: 'codes@conn-ok.example',
        acceptedRecipients: ['codes@conn-ok.example'],
      },
    });
  });

  it('reports a source without connection, a connection without password and an unreadable password', async () => {
    const noPassword = await seedSource('conn-nopw', { password: null });
    expect(await connections.load(noPassword.ref)).toEqual({ ok: false, code: 'PASSWORD_MISSING' });

    const unreadable = await seedSource('conn-bad');
    await db.admin.query(
      'update mail_source_connections set secret_version = 2 where source_id = $1',
      [unreadable.sourceId],
    );
    expect(await connections.load(unreadable.ref)).toEqual({
      ok: false,
      code: 'PASSWORD_UNREADABLE',
    });

    const missing = await seedSource('conn-missing');
    await db.admin.query('delete from mail_source_connections where source_id = $1', [
      missing.sourceId,
    ]);
    expect(await connections.load(missing.ref)).toEqual({ ok: false, code: 'CONNECTION_MISSING' });
  });

  it('does not load a source of another organization', async () => {
    const own = await seedSource('conn-iso-a');
    const other = await seedSource('conn-iso-b');

    const loaded = await connections.load({
      organizationId: own.organization,
      sourceId: other.sourceId,
    });

    expect(loaded).toEqual({ ok: false, code: 'CONNECTION_MISSING' });
  });
});

describe('PgPollableSourceLister', () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const idsOf = async (): Promise<string[]> =>
    (await new PgPollableSourceLister(workerPool).list()).map((source) => source.sourceId);

  it('lists an active source with a stored password and nothing from the other organizations it cannot see', async () => {
    const source = await seedSource('lister-ok');

    expect(await idsOf()).toContain(source.sourceId);
  });

  it('skips a source whose lease is held and lists it again once released', async () => {
    const source = await seedSource('lister-lease');
    // La base compara con su propio reloj: el arrendamiento y el backoff se fijan con la hora real.
    await pollState.claim(source.ref, new Date(), ONE_HOUR_MS);
    expect(await idsOf()).not.toContain(source.sourceId);

    await pollState.releaseAfterSuccess(source.ref, new Date());
    expect(await idsOf()).toContain(source.sourceId);
  });

  it('skips a source in backoff', async () => {
    const source = await seedSource('lister-backoff');
    await pollState.claim(source.ref, new Date(), ONE_HOUR_MS);
    await pollState.releaseAfterFailure(
      source.ref,
      { errorCode: 'NETWORK', nextAttemptAt: new Date(Date.now() + ONE_HOUR_MS) },
      new Date(),
    );

    expect(await idsOf()).not.toContain(source.sourceId);
  });

  it('skips a source without a stored password and an archived one', async () => {
    const noPassword = await seedSource('lister-nopw', { password: null });
    const archived = await seedSource('lister-archived');
    await db.admin.query(
      `update mail_sources set status = 'archived', archived_at = now() where id = $1`,
      [archived.sourceId],
    );

    const listed = await idsOf();

    expect(listed).not.toContain(noPassword.sourceId);
    expect(listed).not.toContain(archived.sourceId);
  });
});
