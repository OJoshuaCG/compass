import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgAuditEventRepository,
  RecordAuditEvent,
  VerifyAuditChain,
} from '../src/modules/audit/index.js';
import type { AuditEventInput } from '../src/modules/audit/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

let db: TestDatabase;
let orgA: string;
let orgB: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let audit: RecordAuditEvent;
let verify: VerifyAuditChain;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = await db.seedOrganization('audit-a');
  orgB = await db.seedOrganization('audit-b');
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  const repository = new PgAuditEventRepository(uow);
  audit = new RecordAuditEvent({ repository, context: requestContext, ids: new UuidV7Generator() });
  verify = new VerifyAuditChain({ repository });
});

afterAll(async () => {
  await db.close();
});

const input = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  action: 'credential.revealed',
  actorId: null,
  targetType: 'credential',
  targetId: '0198eeee-0000-7000-8000-000000000004',
  outcome: 'success',
  reasonCode: null,
  ip: '203.0.113.7',
  requestId: 'req-1',
  metadata: { reason: 'rotating the shared account' },
  ...overrides,
});

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

async function record(org: string, overrides: Partial<AuditEventInput> = {}) {
  return inOrg(org, async () => {
    const result = await audit.record(input(overrides));
    if (!result.ok) throw new Error(`record failed: ${result.error.code}`);
    return result.value;
  });
}

describe('audit chain on PostgreSQL', () => {
  it('chains events: contiguous seq, genesis hash, each prev_hash equals the previous hash', async () => {
    const first = await record(orgA);
    const second = await record(orgA);
    const third = await record(orgA);

    expect(second.seq).toBe(first.seq + 1n);
    expect(third.seq).toBe(second.seq + 1n);
    expect(first.prevHash).toBe('00'.repeat(32));
    expect(second.prevHash).toBe(first.hash);
    expect(third.prevHash).toBe(second.hash);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports an intact chain for the organization in context', async () => {
    await record(orgA);
    const result = await inOrg(orgA, () => verify.execute());
    expect(result).toEqual({ valid: true });
  });

  it('keeps one independent chain per organization', async () => {
    const a = await record(orgA);
    const b = await record(orgB);

    expect(b.seq).toBe(1n);
    expect(b.prevHash).toBe('00'.repeat(32));
    expect(a.seq).toBeGreaterThan(1n);
    expect(await inOrg(orgB, () => verify.execute())).toEqual({ valid: true });
  });

  it('does not fork the chain under concurrent writers of the same organization', async () => {
    const before = await record(orgB);
    const writes = await Promise.all(Array.from({ length: 12 }, () => record(orgB)));

    const seqs = writes.map((e) => e.seq).sort((x, y) => (x < y ? -1 : 1));
    expect(seqs[0]).toBe(before.seq + 1n);
    expect(seqs.at(-1)).toBe(before.seq + 12n);
    expect(new Set(seqs).size).toBe(12);
    expect(await inOrg(orgB, () => verify.execute())).toEqual({ valid: true });
  });

  it('detects a tampered event when someone with database access rewrites history', async () => {
    const target = await record(orgA);
    // Un administrador desactiva el trigger de solo-adición y reescribe el resultado.
    await db.admin.query('alter table audit_events disable trigger audit_events_no_update_delete');
    try {
      await db.admin.query("update audit_events set outcome = 'denied' where id = $1", [target.id]);
    } finally {
      await db.admin.query('alter table audit_events enable trigger audit_events_no_update_delete');
    }

    const result = await inOrg(orgA, () => verify.execute());

    expect(result).toEqual({ valid: false, firstBrokenSeq: target.seq });
  });

  it('refuses UPDATE and DELETE from the application role (append-only)', async () => {
    const event = await record(orgB);

    await expect(
      inOrg(orgB, () =>
        uow.current().query("update audit_events set outcome = 'denied' where id = $1", [event.id]),
      ),
    ).rejects.toThrow();
    await expect(
      inOrg(orgB, () => uow.current().query('delete from audit_events where id = $1', [event.id])),
    ).rejects.toThrow();
  });

  it('fails closed: if the audit write fails, the audited action is rolled back with it', async () => {
    const aggregate = `fail-closed-${String(Date.now())}`;

    await expect(
      inOrg(orgA, async () => {
        await uow
          .current()
          .query(
            "insert into outbox_events (organization_id, aggregate, type, payload) values ($1, $2, 't', '{}')",
            [orgA, aggregate],
          );
        // `targetId` no es un UUID: la base de datos rechaza el evento de auditoría.
        await audit.record(input({ targetId: 'not-a-uuid' }));
      }),
    ).rejects.toThrow();

    const count = await db.admin.query<{ n: string }>(
      'select count(*) as n from outbox_events where aggregate = $1',
      [aggregate],
    );
    expect(count.rows[0]?.n).toBe('0');
  });

  it('rejects metadata outside the allowlist before touching the database', async () => {
    const before = await db.admin.query<{ n: string }>('select count(*) as n from audit_events');

    const result = await inOrg(orgA, () =>
      audit.record(input({ metadata: { password: 'hunter2' } })),
    );

    expect(!result.ok && result.error.code).toBe('AUDIT.METADATA_FIELD_NOT_ALLOWED');
    const after = await db.admin.query<{ n: string }>('select count(*) as n from audit_events');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('never stores a secret even if the caller tries to smuggle it as an allowed field name', async () => {
    const event = await record(orgA, { metadata: { reason: 'routine rotation' } });
    const stored = await db.admin.query<{ metadata: unknown }>(
      'select metadata from audit_events where id = $1',
      [event.id],
    );

    expect(JSON.stringify(stored.rows[0]?.metadata)).toBe('{"reason":"routine rotation"}');
  });

  it('stores the actor when present', async () => {
    const actorSeed = await db.admin.query<{ id: string }>(
      "insert into users (organization_id, email, display_name, rank) values ($1, 'root@a.test', 'Root', 0) returning id",
      [orgA],
    );
    const actorId = actorSeed.rows[0]?.id ?? '';

    const event = await record(orgA, { actorId: asUserId(actorId) });

    expect(event.actorId).toBe(actorId);
  });
});
