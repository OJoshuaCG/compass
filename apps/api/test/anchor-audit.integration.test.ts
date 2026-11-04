import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { AnchorAuditChain, PgAuditAnchorLedger } from '../src/modules/audit/index.js';
import type { AuditAnchorManifest, AuditAnchorPublisher } from '../src/modules/audit/index.js';
import { PgOrganizationLister } from '../src/modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

// SENSIBLE (revisión humana): ancla externa de la auditoría (ADR 0042) contra una base real. El bucket se
// sustituye por un publicador en memoria; el mapeo al comando de S3 lo cubre la prueba unitaria del adaptador.

const NOW = new Date('2026-01-01T12:00:00.000Z');

let db: TestDatabase;
let orgA: string;
let orgB: string;
let uow: PgUnitOfWork;
let scope: PgTenantScope;

interface ManifestBody {
  organizationId: string;
  manifestNumber: string;
  anchoredSeq: string;
  anchoredHash: string;
  prevManifestHash: string;
  manifestHash: string;
}

function anchorChainWith(publisher: AuditAnchorPublisher): AnchorAuditChain {
  return new AnchorAuditChain({
    organizations: new PgOrganizationLister(db.appPool),
    ledger: new PgAuditAnchorLedger(uow),
    publisher,
    scope,
    ids: new UuidV7Generator(),
    clock: { now: () => NOW },
  });
}

function collectingPublisher(published: AuditAnchorManifest[]): AuditAnchorPublisher {
  return {
    publish: (manifest) => {
      published.push(manifest);
      return Promise.resolve();
    },
  };
}

async function appendAuditEvent(organizationId: string): Promise<void> {
  await db.admin.query(
    "insert into audit_events (organization_id, action, outcome) values ($1, 'test.anchor', 'success')",
    [organizationId],
  );
}

async function chainHead(organizationId: string): Promise<{ seq: string; hash: string }> {
  const result = await db.admin.query<{ seq: string; hash: string }>(
    `select seq::text as seq, encode(hash, 'hex') as hash
       from audit_events where organization_id = $1 order by seq desc limit 1`,
    [organizationId],
  );
  const head = result.rows[0];
  if (head === undefined) throw new Error('organization has no audit events');
  return head;
}

async function anchorCount(organizationId: string): Promise<number> {
  const result = await db.admin.query<{ total: string }>(
    'select count(*) as total from audit_anchors where organization_id = $1',
    [organizationId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

function bodyFor(published: AuditAnchorManifest[], organizationId: string): ManifestBody {
  const manifest = published.find((candidate) => candidate.objectKey.includes(organizationId));
  if (manifest === undefined) throw new Error(`no manifest for ${organizationId}`);
  return JSON.parse(manifest.body) as ManifestBody;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('anchor-a');
  orgB = await db.seedOrganization('anchor-b');
  const requestContext = new AsyncLocalRequestContext();
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  scope = new PgTenantScope(requestContext, uow);
});

afterAll(async () => {
  await db.close();
});

describe('AnchorAuditChain against PostgreSQL', () => {
  it('anchors the current chain head of every organization and records it locally', async () => {
    await appendAuditEvent(orgA);
    await appendAuditEvent(orgA);
    await appendAuditEvent(orgB);
    const published: AuditAnchorManifest[] = [];

    const summary = await anchorChainWith(collectingPublisher(published)).execute();

    expect(summary.failedOrganizations).toEqual([]);
    expect(summary.anchored).toBe(summary.organizations);
    for (const organizationId of [orgA, orgB]) {
      const head = await chainHead(organizationId);
      const body = bodyFor(published, organizationId);
      expect(body.organizationId).toBe(organizationId);
      expect(body.anchoredSeq).toBe(head.seq);
      expect(body.anchoredHash).toBe(head.hash);
      expect(await anchorCount(organizationId)).toBe(1);
    }
  });

  it('chains the next manifest to the previous one and follows the new head', async () => {
    const firstRun: AuditAnchorManifest[] = [];
    await anchorChainWith(collectingPublisher(firstRun)).execute();
    await appendAuditEvent(orgA);
    const secondRun: AuditAnchorManifest[] = [];

    await anchorChainWith(collectingPublisher(secondRun)).execute();

    const previous = bodyFor(firstRun, orgA);
    const next = bodyFor(secondRun, orgA);
    expect(Number(next.manifestNumber)).toBe(Number(previous.manifestNumber) + 1);
    expect(next.prevManifestHash).toBe(previous.manifestHash);
    expect(next.anchoredSeq).toBe((await chainHead(orgA)).seq);
  });

  it('keeps no local anchor when publishing fails, and still anchors the other organizations', async () => {
    const anchorsOfABefore = await anchorCount(orgA);
    const anchorsOfBBefore = await anchorCount(orgB);
    const published: AuditAnchorManifest[] = [];
    const failingForA: AuditAnchorPublisher = {
      publish: (manifest) => {
        if (manifest.objectKey.includes(orgA)) {
          return Promise.reject(
            Object.assign(new Error('unavailable'), { name: 'ServiceUnavailable' }),
          );
        }
        published.push(manifest);
        return Promise.resolve();
      },
    };

    const summary = await anchorChainWith(failingForA).execute();

    expect(summary.failedOrganizations).toEqual([
      { organizationId: orgA, reason: 'ServiceUnavailable' },
    ]);
    expect(await anchorCount(orgA)).toBe(anchorsOfABefore);
    expect(await anchorCount(orgB)).toBe(anchorsOfBBefore + 1);
  });
});
