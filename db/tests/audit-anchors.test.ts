import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import {
  connect,
  createMigratedDatabase,
  createOrganization,
  inOrg,
  seedTenant,
  sha256,
  sqlState,
} from './helpers.js';
import type { Tenant } from './helpers.js';

// SENSIBLE (revisión humana): pruebas de la migración 0033 (ADR 0042), registro local del ancla externa de la
// cadena de auditoría. La base asigna el número, la cabeza anclada y los hashes; nadie reescribe el registro.

const ZERO_HASH = Buffer.alloc(32);
const INSUFFICIENT_PRIVILEGE = '42501';

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;
let emptyOrgId = '';
let isolatedOrgId = '';
let concurrentOrgId = '';
let appUrl = '';

interface AnchorRow {
  organization_id: string;
  manifest_number: string;
  anchored_seq: string;
  anchored_hash: Buffer;
  prev_manifest_hash: Buffer;
  manifest_hash: Buffer;
  anchored_at_micros: string;
}

// Valores falsos a propósito en todas las columnas que asigna el trigger, fecha incluida: deben sobrescribirse.
const SPOOFED_ANCHORED_AT = '2000-01-01T00:00:00Z';

async function insertAnchor(orgId: string, client: Client = app): Promise<AnchorRow> {
  const { rows } = await inOrg(client, orgId, () =>
    client.query<AnchorRow>(
      `insert into audit_anchors (organization_id, manifest_number, anchored_seq, anchored_hash,
                                  prev_manifest_hash, manifest_hash, anchored_at)
       values ($1, 999, 999, decode(repeat('ff', 32), 'hex'), decode(repeat('ff', 32), 'hex'),
               decode(repeat('ff', 32), 'hex'), $2)
       returning organization_id, manifest_number::text, anchored_seq::text, anchored_hash,
                 prev_manifest_hash, manifest_hash,
                 floor(extract(epoch from anchored_at) * 1000000)::bigint::text as anchored_at_micros`,
      [orgId, SPOOFED_ANCHORED_AT],
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('anchor insert returned no row');
  return row;
}

async function chainHead(orgId: string): Promise<{ seq: string; hash: Buffer } | undefined> {
  const { rows } = await inOrg(app, orgId, () =>
    app.query<{ seq: string; hash: Buffer }>(
      'select seq::text as seq, hash from audit_events order by seq desc limit 1',
    ),
  );
  return rows[0];
}

async function appendAuditEvent(orgId: string): Promise<void> {
  await inOrg(app, orgId, () =>
    app.query(
      "insert into audit_events (organization_id, action, outcome) values ($1, 'test.anchor', 'success')",
      [orgId],
    ),
  );
}

/**
 * Recalcula el hash del manifiesto fuera de la base, con la codificación documentada en la migración: el texto
 * de jsonb de un arreglo separa los elementos con «, ». Si la función SQL cambiara su fórmula, esto falla.
 */
function expectedManifestHash(row: AnchorRow): Buffer {
  const canonical = `["${row.prev_manifest_hash.toString('hex')}", "${row.organization_id}", ${row.manifest_number}, ${row.anchored_seq}, "${row.anchored_hash.toString('hex')}", ${row.anchored_at_micros}]`;
  return sha256(canonical);
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  emptyOrgId = await createOrganization(db.adminUrl, 'org-anchor-empty');
  isolatedOrgId = await createOrganization(db.adminUrl, 'org-anchor-isolated');
  concurrentOrgId = await createOrganization(db.adminUrl, 'org-anchor-concurrent');
  appUrl = db.appUrl;
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('audit_anchors: the database assigns the anchor', () => {
  it('overwrites client values with the chain head, the next number and a recomputable hash', async () => {
    await appendAuditEvent(a.orgId);
    const head = await chainHead(a.orgId);
    if (head === undefined) throw new Error('tenant a has no audit events');

    const first = await insertAnchor(a.orgId);

    expect(first.manifest_number).toBe('1');
    expect(first.anchored_seq).toBe(head.seq);
    expect(first.anchored_hash.equals(head.hash)).toBe(true);
    expect(first.prev_manifest_hash.equals(ZERO_HASH)).toBe(true);
    expect(first.manifest_hash.equals(expectedManifestHash(first))).toBe(true);
    const spoofedMicros = String(new Date(SPOOFED_ANCHORED_AT).getTime() * 1000);
    expect(first.anchored_at_micros).not.toBe(spoofedMicros);
  });

  it('serializes concurrent anchors of one organization: consecutive numbers, each chained to the previous', async () => {
    const second = await connect(appUrl);
    try {
      const anchors = await Promise.all([
        insertAnchor(concurrentOrgId),
        insertAnchor(concurrentOrgId, second),
      ]);
      const [earlier, later] = [...anchors].sort(
        (left, right) => Number(left.manifest_number) - Number(right.manifest_number),
      );
      if (earlier === undefined || later === undefined) throw new Error('missing anchors');
      expect(Number(later.manifest_number)).toBe(Number(earlier.manifest_number) + 1);
      expect(later.prev_manifest_hash.equals(earlier.manifest_hash)).toBe(true);
    } finally {
      await second.end();
    }
  });

  it('chains each manifest to the previous one of the same organization', async () => {
    const previous = await insertAnchor(a.orgId);
    await appendAuditEvent(a.orgId);
    const head = await chainHead(a.orgId);

    const next = await insertAnchor(a.orgId);

    expect(Number(next.manifest_number)).toBe(Number(previous.manifest_number) + 1);
    expect(next.prev_manifest_hash.equals(previous.manifest_hash)).toBe(true);
    expect(next.anchored_seq).toBe(head?.seq);
    expect(Number(next.anchored_seq)).toBeGreaterThan(Number(previous.anchored_seq));
    expect(next.manifest_hash.equals(expectedManifestHash(next))).toBe(true);
  });

  it('anchors seq 0 and the zero hash for an organization without audit events', async () => {
    const anchor = await insertAnchor(emptyOrgId);

    expect(anchor.manifest_number).toBe('1');
    expect(anchor.anchored_seq).toBe('0');
    expect(anchor.anchored_hash.equals(ZERO_HASH)).toBe(true);
    expect(anchor.manifest_hash.equals(expectedManifestHash(anchor))).toBe(true);
  });

  it('numbers each organization independently', async () => {
    const anchorB = await insertAnchor(b.orgId);

    expect(anchorB.manifest_number).toBe('1');
    expect(anchorB.prev_manifest_hash.equals(ZERO_HASH)).toBe(true);
  });
});

describe('audit_anchors is append-only', () => {
  it('grants iam_app only SELECT and INSERT', async () => {
    const privileges = await admin.query<{
      upd: boolean;
      del: boolean;
      ins: boolean;
      sel: boolean;
    }>(
      `select has_table_privilege('iam_app', 'audit_anchors', 'UPDATE') as upd,
              has_table_privilege('iam_app', 'audit_anchors', 'DELETE') as del,
              has_table_privilege('iam_app', 'audit_anchors', 'INSERT') as ins,
              has_table_privilege('iam_app', 'audit_anchors', 'SELECT') as sel`,
    );
    expect(privileges.rows[0]).toEqual({ upd: false, del: false, ins: true, sel: true });
    expect(await sqlState(app, 'update audit_anchors set anchored_seq = 0', [], a.orgId)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await sqlState(app, 'delete from audit_anchors', [], a.orgId)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await sqlState(app, 'truncate audit_anchors')).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('rejects UPDATE, DELETE and TRUNCATE even for the superuser', async () => {
    await insertAnchor(a.orgId);
    await expect(admin.query('update audit_anchors set anchored_seq = 0')).rejects.toThrow(
      /append-only/,
    );
    await expect(admin.query('delete from audit_anchors')).rejects.toThrow(/append-only/);
    await expect(admin.query('truncate audit_anchors')).rejects.toThrow(/append-only/);
  });
});

describe('audit_anchors isolation', () => {
  it('shows each organization only its own anchors', async () => {
    await insertAnchor(a.orgId);
    await insertAnchor(isolatedOrgId);
    const { rows } = await inOrg(app, isolatedOrgId, () =>
      app.query<{ organization_id: string }>('select organization_id from audit_anchors'),
    );
    expect(rows).toEqual([{ organization_id: isolatedOrgId }]);
  });

  it('rejects an anchor for another organization', async () => {
    const state = await sqlState(
      app,
      'insert into audit_anchors (organization_id, manifest_number, anchored_seq, anchored_hash, prev_manifest_hash, manifest_hash) values ($1, 0, 0, $2, $2, $2)',
      [a.orgId, ZERO_HASH],
      b.orgId,
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
