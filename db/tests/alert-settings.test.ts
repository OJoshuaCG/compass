import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

// SENSIBLE (revisión humana): pruebas de la migración 0034, preferencias de alerta de la Raíz. Al menos un canal
// encendido, sin borrado y con aislamiento por organización.

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

async function insertSettings(
  tenant: Tenant,
  email: boolean,
  telegram: boolean,
): Promise<{ version: number }> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ version: number }>(
      `insert into alert_settings (organization_id, infra_email, infra_telegram, updated_by)
       values ($1, $2, $3, $4) returning version`,
      [tenant.orgId, email, telegram, tenant.rootId],
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error('alert settings insert returned no row');
  return row;
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('alert_settings keeps at least one infrastructure channel', () => {
  it('rejects a row with both channels off', async () => {
    const state = await sqlState(
      app,
      'insert into alert_settings (organization_id, infra_email, infra_telegram, updated_by) values ($1, false, false, $2)',
      [b.orgId, b.rootId],
      b.orgId,
    );
    expect(state).toBe(CHECK_VIOLATION);
  });

  it('starts at version 1 and rejects an update that turns both channels off', async () => {
    const inserted = await insertSettings(a, true, false);
    expect(inserted.version).toBe(1);

    const state = await sqlState(app, 'update alert_settings set infra_email = false', [], a.orgId);
    expect(state).toBe(CHECK_VIOLATION);
  });
});

describe('alert_settings privileges', () => {
  it('grants iam_app no DELETE and does not let it move a row to another organization', async () => {
    const privileges = await admin.query<{ del: boolean; trunc: boolean; updOrg: boolean }>(
      `select has_table_privilege('iam_app', 'alert_settings', 'DELETE') as del,
              has_table_privilege('iam_app', 'alert_settings', 'TRUNCATE') as trunc,
              has_column_privilege('iam_app', 'alert_settings', 'organization_id', 'UPDATE') as "updOrg"`,
    );
    expect(privileges.rows[0]).toEqual({ del: false, trunc: false, updOrg: false });
    expect(await sqlState(app, 'delete from alert_settings', [], a.orgId)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe('alert_settings isolation', () => {
  it('shows each organization only its own settings', async () => {
    await insertSettings(b, false, true);
    const { rows } = await inOrg(app, b.orgId, () =>
      app.query<{ organization_id: string }>('select organization_id from alert_settings'),
    );
    expect(rows).toEqual([{ organization_id: b.orgId }]);
  });

  it('rejects settings for another organization', async () => {
    const state = await sqlState(
      app,
      'insert into alert_settings (organization_id, infra_email, infra_telegram, updated_by) values ($1, true, true, $2)',
      [a.orgId, a.rootId],
      b.orgId,
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
