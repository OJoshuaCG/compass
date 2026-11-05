/**
 * SENSIBLE (ruta protegida: recuperación de la Raíz y auditoría). Esta prueba la debe revisar una persona.
 *
 * Comprueba contra PostgreSQL el almacén de la reemisión de códigos de emergencia (ADR 0048): solo emite
 * cuando no queda ningún código vigente, es atómico y audita únicamente un conteo.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgEmergencyCodeReissueStore } from '../src/modules/provisioning/index.js';
import { startEnvironment } from './support/e2e.js';
import type { E2eEnvironment } from './support/e2e.js';

let env: E2eEnvironment;
let organizationId: string;
let rootUserId: string;
let store: PgEmergencyCodeReissueStore;
let adminPool: Pool;

async function requireActiveRoot() {
  const root = await store.findActiveRoot('reissue');
  if (root === null) throw new Error('The test organization has no active Root.');
  return root;
}

const newCodes = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    hash: new Uint8Array(32).fill(index + 1),
    custodyGroup: index < count / 2 ? ('A' as const) : ('B' as const),
  }));

const liveEmergencyCodes = async (): Promise<number> =>
  (
    await env.db.admin.query(
      `select 1 from user_recovery_codes
        where organization_id = $1 and kind = 'emergency' and used_at is null`,
      [organizationId],
    )
  ).rows.length;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'reissue',
    rootEmail: 'root@reissue.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;
  rootUserId = created.rootUserId;
  adminPool = new Pool({ connectionString: env.db.adminUrl, max: 2 });
  // El alta deja a la Raíz como «invited» hasta su primer ingreso; la reemisión exige una Raíz activa.
  await env.db.admin.query(`update users set status = 'active' where id = $1`, [rootUserId]);
  store = new PgEmergencyCodeReissueStore(adminPool);
});

afterAll(async () => {
  await adminPool.end();
  await env.close();
});

describe('PgEmergencyCodeReissueStore', () => {
  it('refuses to reissue while live emergency codes still exist, leaving them untouched', async () => {
    // El alta de la organización ya dejó los códigos de emergencia vigentes.
    const before = await liveEmergencyCodes();
    expect(before).toBeGreaterThan(0);
    const root = await requireActiveRoot();
    expect(root).toEqual({ organizationId, rootUserId });

    const accepted = await store.reissue({ root, newEmergencyCodes: newCodes(8) });

    expect(accepted).toBe(false);
    expect(await liveEmergencyCodes()).toBe(before);
    const audited = await env.db.admin.query(
      `select 1 from audit_events where organization_id = $1 and action = 'auth.emergency_codes_reissued'`,
      [organizationId],
    );
    expect(audited.rows).toHaveLength(0);
  });

  it('reissues once every code is spent, audits only the count and refuses a second run', async () => {
    await env.db.admin.query(
      `update user_recovery_codes set used_at = now()
        where organization_id = $1 and kind = 'emergency' and used_at is null`,
      [organizationId],
    );
    const root = await requireActiveRoot();

    const first = await store.reissue({ root, newEmergencyCodes: newCodes(8) });
    const second = await store.reissue({ root, newEmergencyCodes: newCodes(8) });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await liveEmergencyCodes()).toBe(8);
    const groups = await env.db.admin.query<{ custody_group: string; total: string }>(
      `select custody_group, count(*) as total from user_recovery_codes
        where organization_id = $1 and kind = 'emergency' and used_at is null
        group by custody_group order by custody_group`,
      [organizationId],
    );
    expect(groups.rows.map((row) => [row.custody_group, row.total])).toEqual([
      ['A', '4'],
      ['B', '4'],
    ]);
    const audited = await env.db.admin.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_events where organization_id = $1 and action = 'auth.emergency_codes_reissued'`,
      [organizationId],
    );
    expect(audited.rows).toHaveLength(1);
    expect(audited.rows[0]?.metadata).toEqual({ codesIssued: 8 });
  });

  it('does not find a Root that is not active', async () => {
    await env.db.admin.query(`update users set status = 'suspended' where id = $1`, [rootUserId]);

    expect(await store.findActiveRoot('reissue')).toBeNull();

    await env.db.admin.query(`update users set status = 'active' where id = $1`, [rootUserId]);
  });
});
