import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgArchivedSourcePollStateStore,
  PgExpiredEphemeralStore,
  PgOrganizationLister,
  PgOutboxRetentionStore,
  PgReplacedPasswordSecretStore,
  PgReplacedTotpSecretStore,
  PurgeExpiredEphemeral,
} from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const NOW = new Date('2026-01-01T12:00:00.000Z');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const LONG_AGO = new Date(NOW.getTime() - TWO_HOURS_MS);
const JUST_EXPIRED = new Date(NOW.getTime() - TEN_MINUTES_MS);
const IN_THE_FUTURE = new Date(NOW.getTime() + TWO_HOURS_MS);

let db: TestDatabase;
let orgA: string;
let orgB: string;
let userA: string;
let userB: string;
let purge: PurgeExpiredEphemeral;

async function seedUser(organizationId: string, email: string): Promise<string> {
  const result = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank) values ($1, $2, 'Seed', 0) returning id",
    [organizationId, email],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
}

async function seedKey(organizationId: string, actorId: string, expiresAt: Date): Promise<void> {
  await db.admin.query(
    `insert into idempotency_keys (organization_id, actor_id, key, request_hash, expires_at)
     values ($1, $2, $3, decode(repeat('ab', 32), 'hex'), $4)`,
    [organizationId, actorId, `key-${randomUUID()}`, expiresAt],
  );
}

async function seedChallenge(
  organizationId: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  await db.admin.query(
    `insert into webauthn_challenges (organization_id, user_id, session_id, purpose, challenge, expires_at)
     values ($1, $2, $3, 'authentication', $4, $5)`,
    [organizationId, userId, randomUUID(), `challenge-${randomUUID()}`, expiresAt],
  );
}

async function count(table: string, organizationId: string): Promise<number> {
  const result = await db.admin.query<{ total: string }>(
    `select count(*) as total from ${table} where organization_id = $1`,
    [organizationId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('purge-a');
  orgB = await db.seedOrganization('purge-b');
  userA = await seedUser(orgA, 'user@purge-a.test');
  userB = await seedUser(orgB, 'user@purge-b.test');

  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  purge = new PurgeExpiredEphemeral({
    organizations: new PgOrganizationLister(db.appPool),
    store: new PgExpiredEphemeralStore(uow),
    replacedTotpSecrets: new PgReplacedTotpSecretStore(uow),
    replacedPasswordSecrets: new PgReplacedPasswordSecretStore(uow),
    archivedSourcePollState: new PgArchivedSourcePollStateStore(uow),
    outboxRetention: new PgOutboxRetentionStore(uow),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: { now: () => NOW },
  });
});

afterAll(async () => {
  await db.close();
});

describe('PurgeExpiredEphemeral', () => {
  it('deletes rows expired beyond the grace period in every organization and keeps the rest', async () => {
    for (const [org, user] of [
      [orgA, userA],
      [orgB, userB],
    ] as const) {
      await seedKey(org, user, LONG_AGO);
      await seedKey(org, user, JUST_EXPIRED);
      await seedKey(org, user, IN_THE_FUTURE);
      await seedChallenge(org, user, LONG_AGO);
      await seedChallenge(org, user, JUST_EXPIRED);
      await seedChallenge(org, user, IN_THE_FUTURE);
    }

    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.idempotencyKeys).toBe(2);
    expect(summary.webauthnChallenges).toBe(2);
    for (const org of [orgA, orgB]) {
      // Sobreviven la que venció hace poco (margen de gracia) y la vigente.
      expect(await count('idempotency_keys', org)).toBe(2);
      expect(await count('webauthn_challenges', org)).toBe(2);
    }
  });

  it('cannot delete rows of another organization even with a cutoff that matches them all', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const store = new PgExpiredEphemeralStore(uow);
    const beforeB = await count('idempotency_keys', orgB);
    const challengesBeforeB = await count('webauthn_challenges', orgB);
    const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

    const deletedAsA = await scope.runAs(
      { organizationId: asOrganizationId(orgA), actorId: null, requestId: 'req-isolation' },
      async () => ({
        keys: await store.purgeIdempotencyKeys(FAR_FUTURE, 1000),
        challenges: await store.purgeWebauthnChallenges(FAR_FUTURE, 1000),
      }),
    );

    // Todo lo de A cae (incluso lo vigente, por el corte) y nada de B se toca.
    expect(deletedAsA).toEqual({ keys: 2, challenges: 2 });
    expect(await count('idempotency_keys', orgA)).toBe(0);
    expect(await count('idempotency_keys', orgB)).toBe(beforeB);
    expect(await count('webauthn_challenges', orgB)).toBe(challengesBeforeB);
  });

  it('is idempotent: a second run deletes nothing', async () => {
    const summary = await purge.execute();

    expect(summary.idempotencyKeys).toBe(0);
    expect(summary.webauthnChallenges).toBe(0);
  });

  it('only lists organization ids to the application role', async () => {
    const lister = new PgOrganizationLister(db.appPool);

    const ids = await lister.listIds();

    expect(ids).toEqual(expect.arrayContaining([orgA, orgB]));
    // La tabla sigue protegida: sin organización fijada, el rol no ve ninguna fila.
    const direct = await db.appPool.query('select id from organizations');
    expect(direct.rowCount).toBe(0);
  });
});

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);
const TOTP_FIELD = 'totp_uri';

interface SecretVersionSeed {
  readonly field: string;
  readonly version: number;
  readonly isCurrent: boolean;
  readonly createdAt: Date;
}

interface TotpOrganizationSeed {
  readonly organizationId: string;
  readonly rootId: string;
  readonly accountId: string;
}

async function seedTotpOrganization(slug: string): Promise<TotpOrganizationSeed> {
  const organizationId = await db.seedOrganization(slug);
  const rootId = await seedUser(organizationId, `root@${slug}.test`);
  await db.admin.query(
    "insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref) values ($1, 1, '\\x0102', 'local/test')",
    [organizationId],
  );
  const account = await db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), 'Cuenta de prueba', $2)
     returning id`,
    [organizationId, rootId],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error('seed failed');
  return { organizationId, rootId, accountId };
}

/** Crea una credencial con las versiones de secreto pedidas; el contenido es relleno sin significado. */
async function seedCredentialWithVersions(
  organization: TotpOrganizationSeed,
  versions: readonly SecretVersionSeed[],
): Promise<string> {
  const credential = await db.admin.query<{ id: string }>(
    `insert into credentials (organization_id, account_id, label, kind, created_by)
     values ($1, $2, 'Credencial de prueba', 'password_totp', $3) returning id`,
    [organization.organizationId, organization.accountId, organization.rootId],
  );
  const credentialId = credential.rows[0]?.id;
  if (credentialId === undefined) throw new Error('seed failed');
  for (const version of versions) {
    await db.admin.query(
      `insert into credential_secrets
         (organization_id, credential_id, field, version, ciphertext, nonce, dek_version, is_current,
          created_by, created_at)
       values ($1, $2, $3, $4, '\\x00112233445566778899aabbccddeeff00', '\\x000000000000000000000000', 1,
               $5, $6, $7)`,
      [
        organization.organizationId,
        credentialId,
        version.field,
        version.version,
        version.isCurrent,
        organization.rootId,
        version.createdAt,
      ],
    );
  }
  return credentialId;
}

async function versionsOf(credentialId: string, field: string): Promise<number[]> {
  const result = await db.admin.query<{ version: number }>(
    'select version from credential_secrets where credential_id = $1 and field = $2 order by version',
    [credentialId, field],
  );
  return result.rows.map((row) => row.version);
}

describe('PurgeExpiredEphemeral: replaced TOTP secret versions (H1b)', () => {
  let totpOrgA: TotpOrganizationSeed;
  let totpOrgB: TotpOrganizationSeed;
  const credentialsA: Record<string, string> = {};
  let credentialB: string;

  beforeAll(async () => {
    totpOrgA = await seedTotpOrganization('purge-totp-a');
    totpOrgB = await seedTotpOrganization('purge-totp-b');

    // Reemplazada hace 35 días: se borra la v1; la v2 vigente se queda.
    credentialsA['old'] = await seedCredentialWithVersions(totpOrgA, [
      { field: TOTP_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(40) },
      { field: TOTP_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(35) },
    ]);
    // Reemplazada hace 5 días: aún dentro de los 30 días de retención.
    credentialsA['recent'] = await seedCredentialWithVersions(totpOrgA, [
      { field: TOTP_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(40) },
      { field: TOTP_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(5) },
    ]);
    // Cadena: la v1 se reemplazó hace 40 días (se borra); la v2 hace 1 día (se queda).
    credentialsA['chain'] = await seedCredentialWithVersions(totpOrgA, [
      { field: TOTP_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(60) },
      { field: TOTP_FIELD, version: 2, isCurrent: false, createdAt: daysAgo(40) },
      { field: TOTP_FIELD, version: 3, isCurrent: true, createdAt: daysAgo(1) },
    ]);
    // Versión vigente muy antigua y sin reemplazo: nunca se borra.
    credentialsA['onlyCurrent'] = await seedCredentialWithVersions(totpOrgA, [
      { field: TOTP_FIELD, version: 1, isCurrent: true, createdAt: daysAgo(400) },
    ]);
    credentialB = await seedCredentialWithVersions(totpOrgB, [
      { field: TOTP_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(40) },
      { field: TOTP_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(35) },
    ]);
  });

  it('deletes only superseded TOTP versions replaced more than 30 days ago, in every organization', async () => {
    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([]);
    // Organización A: v1 de "old" y v1 de "chain". Organización B: v1 de su credencial.
    expect(summary.replacedTotpSecrets).toBe(3);
    expect(await versionsOf(credentialsA['old'] ?? '', TOTP_FIELD)).toEqual([2]);
    expect(await versionsOf(credentialsA['recent'] ?? '', TOTP_FIELD)).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['chain'] ?? '', TOTP_FIELD)).toEqual([2, 3]);
    expect(await versionsOf(credentialsA['onlyCurrent'] ?? '', TOTP_FIELD)).toEqual([1]);
    expect(await versionsOf(credentialB, TOTP_FIELD)).toEqual([2]);
  });

  it('is idempotent: a second run deletes nothing', async () => {
    const summary = await purge.execute();

    expect(summary.replacedTotpSecrets).toBe(0);
  });

  it('cannot delete the current version or another organization even with a far-future cutoff', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const store = new PgReplacedTotpSecretStore(uow);
    const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');
    const credentialRecent = credentialsA['recent'] ?? '';
    const credentialOnlyCurrent = credentialsA['onlyCurrent'] ?? '';

    // Hace falta una v1 de B no vigente y reemplazada para comprobar el aislamiento.
    const isolatedB = await seedCredentialWithVersions(totpOrgB, [
      { field: TOTP_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(10) },
      { field: TOTP_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(9) },
    ]);

    const deletedAsA = await scope.runAs(
      {
        organizationId: asOrganizationId(totpOrgA.organizationId),
        actorId: null,
        requestId: 'req-isolation-totp',
      },
      () => store.purgeReplacedTotpSecrets(FAR_FUTURE, 1000),
    );

    // Con el corte en el futuro caen las versiones no vigentes que tienen sucesora: la v1 de
    // "recent" y la v2 de "chain" (la primera prueba ya había borrado la v1 de "chain"). Las
    // vigentes y las de otra organización permanecen.
    expect(deletedAsA).toBe(2);
    expect(await versionsOf(credentialRecent, TOTP_FIELD)).toEqual([2]);
    expect(await versionsOf(credentialsA['chain'] ?? '', TOTP_FIELD)).toEqual([3]);
    expect(await versionsOf(credentialOnlyCurrent, TOTP_FIELD)).toEqual([1]);
    expect(await versionsOf(isolatedB, TOTP_FIELD)).toEqual([1, 2]);
  });
});

// SENSIBLE (revisión humana): destrucción de versiones de contraseña (C9), aislamiento por organización y
// protección de la versión vigente y de los campos cuya retención no se decidió.
describe('PurgeExpiredEphemeral: replaced password versions (C9)', () => {
  const PASSWORD_FIELD = 'password';
  const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');
  let passwordOrgA: TotpOrganizationSeed;
  let passwordOrgB: TotpOrganizationSeed;
  const credentialsA: Record<string, string> = {};
  let credentialB: string;

  beforeAll(async () => {
    passwordOrgA = await seedTotpOrganization('purge-password-a');
    passwordOrgB = await seedTotpOrganization('purge-password-b');

    // Reemplazada hace 35 días: se borra la v1; la v2 vigente se queda.
    credentialsA['old'] = await seedCredentialWithVersions(passwordOrgA, [
      { field: PASSWORD_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(40) },
      { field: PASSWORD_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(35) },
    ]);
    // Reemplazada hace 29 días: aún dentro de los 30 días de retención.
    credentialsA['recent'] = await seedCredentialWithVersions(passwordOrgA, [
      { field: PASSWORD_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(400) },
      { field: PASSWORD_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(29) },
    ]);
    // Contraseña vigente muy antigua y sin reemplazo: nunca se borra.
    credentialsA['onlyCurrent'] = await seedCredentialWithVersions(passwordOrgA, [
      { field: PASSWORD_FIELD, version: 1, isCurrent: true, createdAt: daysAgo(400) },
    ]);
    // Campos cuya retención no está decidida: sus versiones viejas se conservan.
    credentialsA['otherFields'] = await seedCredentialWithVersions(passwordOrgA, [
      { field: 'username', version: 1, isCurrent: false, createdAt: daysAgo(400) },
      { field: 'username', version: 2, isCurrent: true, createdAt: daysAgo(390) },
      { field: 'recovery_codes', version: 1, isCurrent: false, createdAt: daysAgo(400) },
      { field: 'recovery_codes', version: 2, isCurrent: true, createdAt: daysAgo(390) },
      { field: 'secret_notes', version: 1, isCurrent: false, createdAt: daysAgo(400) },
      { field: 'secret_notes', version: 2, isCurrent: true, createdAt: daysAgo(390) },
    ]);
    credentialB = await seedCredentialWithVersions(passwordOrgB, [
      { field: PASSWORD_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(40) },
      { field: PASSWORD_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(35) },
    ]);
  });

  it('deletes only superseded password versions replaced more than 30 days ago, in every organization', async () => {
    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([]);
    // Organización A: v1 de "old". Organización B: v1 de su credencial.
    expect(summary.replacedPasswordSecrets).toBe(2);
    expect(await versionsOf(credentialsA['old'] ?? '', PASSWORD_FIELD)).toEqual([2]);
    expect(await versionsOf(credentialsA['recent'] ?? '', PASSWORD_FIELD)).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['onlyCurrent'] ?? '', PASSWORD_FIELD)).toEqual([1]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'username')).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'recovery_codes')).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'secret_notes')).toEqual([1, 2]);
    expect(await versionsOf(credentialB, PASSWORD_FIELD)).toEqual([2]);
  });

  it('is idempotent: a second run deletes nothing', async () => {
    const summary = await purge.execute();

    expect(summary.replacedPasswordSecrets).toBe(0);
  });

  it('the TOTP store never deletes password versions, even with a far-future cutoff', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const totpStore = new PgReplacedTotpSecretStore(uow);

    const deleted = await scope.runAs(
      {
        organizationId: asOrganizationId(passwordOrgA.organizationId),
        actorId: null,
        requestId: 'req-totp-ignores-passwords',
      },
      () => totpStore.purgeReplacedTotpSecrets(FAR_FUTURE, 1000),
    );

    expect(deleted).toBe(0);
    expect(await versionsOf(credentialsA['recent'] ?? '', PASSWORD_FIELD)).toEqual([1, 2]);
  });

  it('cannot delete the current version, other fields or another organization even with a far-future cutoff', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const store = new PgReplacedPasswordSecretStore(uow);

    // Una v1 de B no vigente y reemplazada para comprobar el aislamiento.
    const isolatedB = await seedCredentialWithVersions(passwordOrgB, [
      { field: PASSWORD_FIELD, version: 1, isCurrent: false, createdAt: daysAgo(10) },
      { field: PASSWORD_FIELD, version: 2, isCurrent: true, createdAt: daysAgo(9) },
    ]);

    const deletedAsA = await scope.runAs(
      {
        organizationId: asOrganizationId(passwordOrgA.organizationId),
        actorId: null,
        requestId: 'req-isolation-password',
      },
      () => store.purgeReplacedPasswordSecrets(FAR_FUTURE, 1000),
    );

    // Con el corte en el futuro solo cae la v1 de "recent": es la única no vigente de A con sucesora.
    expect(deletedAsA).toBe(1);
    expect(await versionsOf(credentialsA['recent'] ?? '', PASSWORD_FIELD)).toEqual([2]);
    expect(await versionsOf(credentialsA['onlyCurrent'] ?? '', PASSWORD_FIELD)).toEqual([1]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'username')).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'recovery_codes')).toEqual([1, 2]);
    expect(await versionsOf(credentialsA['otherFields'] ?? '', 'secret_notes')).toEqual([1, 2]);
    expect(await versionsOf(isolatedB, PASSWORD_FIELD)).toEqual([1, 2]);
  });
});

interface OutboxEventSeed {
  /** Momento de publicación; `null` si el evento no se publicó. */
  readonly publishedAt: Date | null;
  /** `true` deja el evento en cuarentena (dead letter): sin publicar y con `next_attempt_at = 'infinity'`. */
  readonly isDeadLetter: boolean;
  /** Nombres de manejador de los acuses de entrega que se crean para el evento. */
  readonly receiptHandlers: readonly string[];
}

async function seedOutboxEvent(organizationId: string, seed: OutboxEventSeed): Promise<string> {
  const event = await db.admin.query<{ id: string }>(
    `insert into outbox_events (organization_id, aggregate, type, payload, published_at, next_attempt_at)
     values ($1, 'test', 'test.event', '{"marker":"retention"}', $2,
             case when $3::boolean then 'infinity'::timestamptz else now() end)
     returning id`,
    [organizationId, seed.publishedAt, seed.isDeadLetter],
  );
  const eventId = event.rows[0]?.id;
  if (eventId === undefined) throw new Error('seed failed');
  for (const handlerKey of seed.receiptHandlers) {
    await db.admin.query(
      'insert into outbox_deliveries (organization_id, event_id, handler_key) values ($1, $2, $3)',
      [organizationId, eventId, handlerKey],
    );
  }
  return eventId;
}

async function outboxEventExists(eventId: string): Promise<boolean> {
  const result = await db.admin.query('select 1 from outbox_events where id = $1', [eventId]);
  return (result.rowCount ?? 0) > 0;
}

async function receiptCount(eventId: string): Promise<number> {
  const result = await db.admin.query<{ total: string }>(
    'select count(*) as total from outbox_deliveries where event_id = $1',
    [eventId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

describe('PurgeExpiredEphemeral: outbox retention (D6)', () => {
  let outboxOrgA: string;
  let outboxOrgB: string;
  const eventsA: Record<string, string> = {};
  const eventsB: Record<string, string> = {};

  beforeAll(async () => {
    outboxOrgA = await db.seedOrganization('purge-outbox-a');
    outboxOrgB = await db.seedOrganization('purge-outbox-b');

    // Publicado hace 8 días, con dos acuses: se borra con ellos.
    eventsA['oldPublished'] = await seedOutboxEvent(outboxOrgA, {
      publishedAt: daysAgo(8),
      isDeadLetter: false,
      receiptHandlers: ['test.handler:one', 'test.handler:two'],
    });
    // Publicado hace 6 días: dentro de la retención de 7 días.
    eventsA['recentPublished'] = await seedOutboxEvent(outboxOrgA, {
      publishedAt: daysAgo(6),
      isDeadLetter: false,
      receiptHandlers: ['test.handler:one'],
    });
    // Sin publicar, aunque con acuses y muy viejo: nunca se borra.
    eventsA['unpublished'] = await seedOutboxEvent(outboxOrgA, {
      publishedAt: null,
      isDeadLetter: false,
      receiptHandlers: ['test.handler:one'],
    });
    // Cuarentena (dead letter): requiere revisión humana, nunca se borra.
    eventsA['deadLetter'] = await seedOutboxEvent(outboxOrgA, {
      publishedAt: null,
      isDeadLetter: true,
      receiptHandlers: ['test.handler:one'],
    });
    eventsB['oldPublished'] = await seedOutboxEvent(outboxOrgB, {
      publishedAt: daysAgo(30),
      isDeadLetter: false,
      receiptHandlers: ['test.handler:one'],
    });
    eventsB['recentPublished'] = await seedOutboxEvent(outboxOrgB, {
      publishedAt: daysAgo(1),
      isDeadLetter: false,
      receiptHandlers: ['test.handler:one'],
    });
  });

  it('deletes published events older than 7 days with their receipts, in every organization', async () => {
    const summary = await purge.execute();

    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.outboxEvents).toBe(2);
    expect(summary.outboxDeliveries).toBe(3);
    expect(await outboxEventExists(eventsA['oldPublished'] ?? '')).toBe(false);
    expect(await receiptCount(eventsA['oldPublished'] ?? '')).toBe(0);
    expect(await outboxEventExists(eventsB['oldPublished'] ?? '')).toBe(false);
    expect(await receiptCount(eventsB['oldPublished'] ?? '')).toBe(0);
  });

  it('keeps recent published events, unpublished events and dead letters with their receipts', async () => {
    for (const eventId of [
      eventsA['recentPublished'],
      eventsA['unpublished'],
      eventsA['deadLetter'],
      eventsB['recentPublished'],
    ]) {
      expect(await outboxEventExists(eventId ?? '')).toBe(true);
      expect(await receiptCount(eventId ?? '')).toBe(1);
    }
  });

  it('is idempotent: a second run deletes nothing', async () => {
    const summary = await purge.execute();

    expect(summary.outboxEvents).toBe(0);
    expect(summary.outboxDeliveries).toBe(0);
  });

  // SENSIBLE (revisión humana): aislamiento por organización y protección de lo no publicado.
  it('cannot delete events of another organization, unpublished events or dead letters even with a far-future cutoff', async () => {
    const requestContext = new AsyncLocalRequestContext();
    const uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
    const scope = new PgTenantScope(requestContext, uow);
    const store = new PgOutboxRetentionStore(uow);
    const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

    const deletedAsA = await scope.runAs(
      {
        organizationId: asOrganizationId(outboxOrgA),
        actorId: null,
        requestId: 'req-isolation-outbox',
      },
      () => store.purgePublishedEvents(FAR_FUTURE, 1000),
    );

    // Con el corte en el futuro cae el publicado reciente de A con su acuse; nada más.
    expect(deletedAsA).toEqual({ events: 1, deliveries: 1 });
    expect(await outboxEventExists(eventsA['recentPublished'] ?? '')).toBe(false);
    expect(await outboxEventExists(eventsA['unpublished'] ?? '')).toBe(true);
    expect(await receiptCount(eventsA['unpublished'] ?? '')).toBe(1);
    expect(await outboxEventExists(eventsA['deadLetter'] ?? '')).toBe(true);
    expect(await receiptCount(eventsA['deadLetter'] ?? '')).toBe(1);
    // Nada de B se tocó.
    expect(await outboxEventExists(eventsB['recentPublished'] ?? '')).toBe(true);
    expect(await receiptCount(eventsB['recentPublished'] ?? '')).toBe(1);
  });

  // SENSIBLE (revisión humana): permisos mínimos de la migración 0022 sobre los acuses.
  it('gives the application role DELETE on receipts but never UPDATE', async () => {
    const result = await db.admin.query<{ can_delete: boolean; can_update: boolean }>(
      `select has_table_privilege('iam_app', 'outbox_deliveries', 'DELETE') as can_delete,
              has_table_privilege('iam_app', 'outbox_deliveries', 'UPDATE') as can_update`,
    );

    expect(result.rows[0]).toEqual({ can_delete: true, can_update: false });
  });

  // SENSIBLE (revisión humana): solo se borra el cursor de fuentes archivadas, nunca el de las vivas.
  describe('poll state of archived mail sources (IC-3a)', () => {
    async function seedSourceWithPollState(
      organizationId: string,
      userId: string,
      address: string,
      status: 'active' | 'suspended' | 'archived',
    ): Promise<string> {
      const source = await db.admin.query<{ id: string }>(
        `insert into mail_sources (organization_id, channel, address, display_name, created_by, status, archived_at)
         values ($1, 'mail', $2, 'Buzón', $3, $4, case when $4 = 'archived' then now() else null end)
         returning id`,
        [organizationId, address, userId, status],
      );
      const sourceId = source.rows[0]?.id;
      if (sourceId === undefined) throw new Error('seed failed');
      await db.admin.query(
        'insert into mail_source_poll_state (organization_id, source_id) values ($1, $2)',
        [organizationId, sourceId],
      );
      return sourceId;
    }

    async function pollStateExists(sourceId: string): Promise<boolean> {
      const result = await db.admin.query(
        'select 1 from mail_source_poll_state where source_id = $1',
        [sourceId],
      );
      return result.rowCount === 1;
    }

    it('deletes the state of archived sources in every organization and keeps active and suspended ones', async () => {
      const archivedA = await seedSourceWithPollState(orgA, userA, 'old-a@purge.test', 'archived');
      const activeA = await seedSourceWithPollState(orgA, userA, 'live-a@purge.test', 'active');
      const suspendedA = await seedSourceWithPollState(
        orgA,
        userA,
        'pause-a@purge.test',
        'suspended',
      );
      const archivedB = await seedSourceWithPollState(orgB, userB, 'old-b@purge.test', 'archived');

      const summary = await purge.execute();

      expect(summary.failedOrganizations).toEqual([]);
      expect(summary.archivedSourcePollStates).toBe(2);
      expect(await pollStateExists(archivedA)).toBe(false);
      expect(await pollStateExists(archivedB)).toBe(false);
      expect(await pollStateExists(activeA)).toBe(true);
      expect(await pollStateExists(suspendedA)).toBe(true);
    });
  });
});
