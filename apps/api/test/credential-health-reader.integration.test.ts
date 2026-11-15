import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { PgCredentialHealthReader } from '../src/modules/vault/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const SHARED_FINGERPRINT_HEX = 'aa'.repeat(32);
const OTHER_FINGERPRINT_HEX = 'bb'.repeat(32);

interface SeededOrganization {
  readonly organizationId: string;
  readonly rootId: string;
  readonly accountId: string;
  readonly otherAccountId: string;
}

let db: TestDatabase;
let orgA: SeededOrganization;
let orgB: SeededOrganization;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;

async function seedAccount(organizationId: string, rootId: string, name: string, slug: string) {
  const account = await db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by)
     values ($1, (select id from platforms where slug = $3 and organization_id is null), $4, $2)
     returning id`,
    [organizationId, rootId, slug, name],
  );
  const accountId = account.rows[0]?.id;
  if (accountId === undefined) throw new Error('seed failed');
  return accountId;
}

async function seedOrganization(slug: string): Promise<SeededOrganization> {
  const organizationId = await db.seedOrganization(slug);
  const root = await db.admin.query<{ id: string }>(
    "insert into users (organization_id, email, display_name, rank, status, locale) values ($1, $2, 'Root', 0, 'active', 'en-US') returning id",
    [organizationId, `root@${slug}.test`],
  );
  const rootId = root.rows[0]?.id;
  if (rootId === undefined) throw new Error('seed failed');
  const accountId = await seedAccount(organizationId, rootId, 'Cuenta A', 'custom');
  const otherAccountId = await seedAccount(organizationId, rootId, 'Cuenta B', 'custom');
  return { organizationId, rootId, accountId, otherAccountId };
}

interface CredentialSeed {
  readonly label: string;
  readonly accountId?: string;
  readonly fingerprintHex?: string;
  readonly strengthScore?: number;
  readonly archived?: boolean;
  readonly rotatedDaysAgo?: number;
}

async function seedCredential(organization: SeededOrganization, seed: CredentialSeed) {
  const credential = await db.admin.query<{ id: string }>(
    `insert into credentials
       (organization_id, account_id, label, kind, created_by, archived_at, last_rotated_at)
     values ($1, $2, $3, 'password_totp', $4, $5, $6)
     returning id`,
    [
      organization.organizationId,
      seed.accountId ?? organization.accountId,
      seed.label,
      organization.rootId,
      seed.archived === true ? new Date() : null,
      seed.rotatedDaysAgo === undefined
        ? null
        : new Date(Date.now() - seed.rotatedDaysAgo * 24 * 60 * 60 * 1000),
    ],
  );
  const credentialId = credential.rows[0]?.id;
  if (credentialId === undefined) throw new Error('seed failed');
  if (seed.fingerprintHex !== undefined) {
    await db.admin.query(
      `insert into password_fingerprints (organization_id, credential_id, hmac, strength_score, strength_scored_at)
       values ($1, $2, decode($3, 'hex'), $4, now())`,
      [organization.organizationId, credentialId, seed.fingerprintHex, seed.strengthScore ?? null],
    );
  }
  return credentialId;
}

async function readFacts(organization: SeededOrganization, accountId: string) {
  return requestContext.run(contextFor(organization.organizationId), () =>
    uow.run(() => new PgCredentialHealthReader(uow).factsByAccount(accountId)),
  );
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  orgA = await seedOrganization('health-a');
  orgB = await seedOrganization('health-b');
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.admin.query('delete from rotation_tasks');
  await db.admin.query('delete from credential_totp');
  await db.admin.query('delete from password_fingerprints');
  await db.admin.query('delete from credentials');
});

describe('PgCredentialHealthReader against PostgreSQL', () => {
  it('returns the score as null for a credential without fingerprint and the stored score otherwise', async () => {
    const withScore = await seedCredential(orgA, {
      label: 'a-con-puntaje',
      fingerprintHex: OTHER_FINGERPRINT_HEX,
      strengthScore: 1,
    });
    const withoutFingerprint = await seedCredential(orgA, { label: 'b-sin-huella' });

    const facts = await readFacts(orgA, orgA.accountId);

    expect(facts.map((entry) => entry.credentialId)).toEqual([withScore, withoutFingerprint]);
    expect(facts[0]?.strengthScore).toBe(1);
    expect(facts[1]?.strengthScore).toBeNull();
    expect(facts[1]?.reusedByOtherCredentials).toBe(0);
  });

  it('counts reuse across accounts of the same organization, ignoring archived credentials', async () => {
    await seedCredential(orgA, { label: 'a', fingerprintHex: SHARED_FINGERPRINT_HEX });
    await seedCredential(orgA, {
      label: 'otra-cuenta',
      accountId: orgA.otherAccountId,
      fingerprintHex: SHARED_FINGERPRINT_HEX,
    });
    await seedCredential(orgA, {
      label: 'archivada',
      accountId: orgA.otherAccountId,
      fingerprintHex: SHARED_FINGERPRINT_HEX,
      archived: true,
    });

    const facts = await readFacts(orgA, orgA.accountId);

    expect(facts).toHaveLength(1);
    expect(facts[0]?.reusedByOtherCredentials).toBe(1);
  });

  it('never counts the same fingerprint of another organization as reuse', async () => {
    await seedCredential(orgA, { label: 'a', fingerprintHex: SHARED_FINGERPRINT_HEX });
    await seedCredential(orgB, { label: 'b', fingerprintHex: SHARED_FINGERPRINT_HEX });

    const facts = await readFacts(orgA, orgA.accountId);

    expect(facts[0]?.reusedByOtherCredentials).toBe(0);
  });

  it('reports the second factor state, its exposure and open rotation tasks', async () => {
    const credentialId = await seedCredential(orgA, { label: 'a', rotatedDaysAgo: 120 });
    await db.admin.query(
      `insert into credential_totp
         (organization_id, credential_id, secret_version, status, algorithm, digits, period_seconds,
          registered_by, verified_at, exposed_at)
       values ($1, $2, 1, 'verified', 'SHA1', 6, 30, $3, now(), now())`,
      [orgA.organizationId, credentialId, orgA.rootId],
    );
    await db.admin.query(
      `insert into rotation_tasks (organization_id, credential_id, trigger, assigned_to, due_at)
       values ($1, $2, 'totp_exported', $3, now() + interval '7 days')`,
      [orgA.organizationId, credentialId, orgA.rootId],
    );

    const facts = await readFacts(orgA, orgA.accountId);

    expect(facts[0]).toMatchObject({
      totpState: 'verified',
      totpExposed: true,
      hasOpenRotationTask: true,
      platformSupportsTotp: true,
    });
    const ageInDays = (Date.now() - (facts[0]?.lastChangedAt.getTime() ?? 0)) / 86_400_000;
    expect(Math.round(ageInDays)).toBe(120);
  });

  it('ignores finished rotation tasks and reads nothing from another organization', async () => {
    const credentialId = await seedCredential(orgA, { label: 'a' });
    await db.admin.query(
      `insert into rotation_tasks
         (organization_id, credential_id, trigger, assigned_to, status, due_at, completed_at)
       values ($1, $2, 'manual', $3, 'done', now(), now())`,
      [orgA.organizationId, credentialId, orgA.rootId],
    );

    expect((await readFacts(orgA, orgA.accountId))[0]?.hasOpenRotationTask).toBe(false);
    expect(await readFacts(orgB, orgA.accountId)).toEqual([]);
  });
});
