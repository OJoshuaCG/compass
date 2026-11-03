import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

// Pruebas de la migración 0032 (ADR 0047): tablas `integrations` e `integration_secrets`.

const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
const NONCE = '\\x000000000000000000000000';
const NO_FAILURE = 'none';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NO_PRIVILEGE = '42501';
const RLS_VIOLATION = '42501';
// Dentro de una transacción de la API con otra organización fijada, la política de aislamiento
// rechaza la fila con el mismo código que un privilegio faltante.
const MAX_CONFIG_BYTES = 8192;

let admin: Client;
let app: Client;
let worker: Client;
let a: Tenant;
let b: Tenant;

interface IntegrationOverrides {
  kind?: string;
  name?: string;
  status?: string;
  archivedAt?: string | null;
  config?: string;
}

async function insertIntegration(
  tenant: Tenant,
  overrides: IntegrationOverrides = {},
): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(
      `insert into integrations (organization_id, kind, name, status, archived_at, config, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7) returning id`,
      [
        tenant.orgId,
        overrides.kind ?? 'sms_pull',
        overrides.name ?? 'Integración de prueba',
        overrides.status ?? 'active',
        overrides.archivedAt ?? null,
        overrides.config ?? '{}',
        tenant.rootId,
      ],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('integration was not created');
  return row.id;
}

async function integrationOutcome(
  tenant: Tenant,
  overrides: IntegrationOverrides = {},
): Promise<string> {
  try {
    await insertIntegration(tenant, overrides);
    return NO_FAILURE;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

interface SecretOverrides {
  field?: string;
  ciphertext?: string;
  nonce?: string;
  dekVersion?: number;
}

async function insertSecret(
  tenant: Tenant,
  integrationId: string,
  overrides: SecretOverrides = {},
  fixedOrganizationId: string = tenant.orgId,
): Promise<string> {
  return sqlState(
    app,
    `insert into integration_secrets
       (organization_id, integration_id, field, ciphertext, nonce, dek_version)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      fixedOrganizationId,
      integrationId,
      overrides.field ?? 'bot_token',
      overrides.ciphertext ?? CIPHERTEXT,
      overrides.nonce ?? NONCE,
      overrides.dekVersion ?? 1,
    ],
    tenant.orgId,
  );
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  worker = await connect(db.workerUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
  await worker.end();
});

describe('integrations: structure', () => {
  it('accepts a valid integration and rejects an unknown kind or an empty name', async () => {
    expect(await integrationOutcome(a)).toBe(NO_FAILURE);
    expect(await integrationOutcome(a, { kind: 'webhook' })).toBe(CHECK_VIOLATION);
    expect(await integrationOutcome(a, { name: '   ' })).toBe(CHECK_VIOLATION);
  });

  it('requires config to be a JSON object no larger than 8 KiB', async () => {
    expect(await integrationOutcome(a, { config: '[]' })).toBe(CHECK_VIOLATION);
    expect(await integrationOutcome(a, { config: '"texto"' })).toBe(CHECK_VIOLATION);
    const oversized = JSON.stringify({ note: 'x'.repeat(MAX_CONFIG_BYTES) });
    expect(await integrationOutcome(a, { config: oversized })).toBe(CHECK_VIOLATION);
  });

  it('keeps status and archived_at consistent', async () => {
    expect(await integrationOutcome(a, { status: 'archived' })).toBe(CHECK_VIOLATION);
    expect(await integrationOutcome(a, { status: 'active', archivedAt: new Date().toISOString() })).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await integrationOutcome(a, { status: 'archived', archivedAt: new Date().toISOString() }),
    ).toBe(NO_FAILURE);
  });

  it('allows one active Telegram channel of each kind per organization, but many SMS integrations', async () => {
    expect(await integrationOutcome(a, { kind: 'telegram_security' })).toBe(NO_FAILURE);
    expect(await integrationOutcome(a, { kind: 'telegram_security' })).toBe(UNIQUE_VIOLATION);
    expect(await integrationOutcome(a, { kind: 'telegram_infra' })).toBe(NO_FAILURE);
    expect(await integrationOutcome(a, { kind: 'telegram_infra' })).toBe(UNIQUE_VIOLATION);
    expect(await integrationOutcome(a, { kind: 'sms_pull' })).toBe(NO_FAILURE);
    expect(await integrationOutcome(a, { kind: 'sms_pull' })).toBe(NO_FAILURE);
    // Otra organización tiene sus propios canales.
    expect(await integrationOutcome(b, { kind: 'telegram_security' })).toBe(NO_FAILURE);
  });

  it('lets an archived Telegram channel be replaced by a new active one', async () => {
    const archivedAt = new Date().toISOString();
    expect(
      await integrationOutcome(b, { kind: 'telegram_infra', status: 'archived', archivedAt }),
    ).toBe(NO_FAILURE);
    expect(await integrationOutcome(b, { kind: 'telegram_infra' })).toBe(NO_FAILURE);
  });
});

describe('integration_secrets: structure', () => {
  it('accepts a valid secret and rejects unknown fields, short ciphertext and bad nonce', async () => {
    const integrationId = await insertIntegration(a);
    expect(await insertSecret(a, integrationId, { field: 'api_key' })).toBe(NO_FAILURE);
    expect(await insertSecret(a, integrationId, { field: 'password' })).toBe(CHECK_VIOLATION);
    expect(await insertSecret(a, integrationId, { ciphertext: '\\x0011' })).toBe(CHECK_VIOLATION);
    expect(await insertSecret(a, integrationId, { nonce: '\\x0000' })).toBe(CHECK_VIOLATION);
  });

  it('allows one secret per integration and field, and requires a data key that exists', async () => {
    const integrationId = await insertIntegration(a);
    expect(await insertSecret(a, integrationId)).toBe(NO_FAILURE);
    expect(await insertSecret(a, integrationId)).toBe(UNIQUE_VIOLATION);
    const other = await insertIntegration(a);
    expect(await insertSecret(a, other, { dekVersion: 9999 })).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('requires the integration to exist in the same organization', async () => {
    const integrationOfA = await insertIntegration(a);
    expect(await insertSecret(b, integrationOfA)).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('integrations: privileges and isolation', () => {
  it('never lets the API delete an integration or a secret', async () => {
    const integrationId = await insertIntegration(a);
    await insertSecret(a, integrationId);
    expect(await sqlState(app, 'delete from integration_secrets', [], a.orgId)).toBe(NO_PRIVILEGE);
    expect(await sqlState(app, 'delete from integrations', [], a.orgId)).toBe(NO_PRIVILEGE);
  });

  it('does not let the API change the kind, owner or organization of an integration', async () => {
    const integrationId = await insertIntegration(a);
    for (const column of ['kind', 'created_by', 'organization_id']) {
      const outcome = await sqlState(
        app,
        `update integrations set ${column} = ${column} where id = $1`,
        [integrationId],
        a.orgId,
      );
      expect(outcome, column).toBe(NO_PRIVILEGE);
    }
    expect(
      await sqlState(app, "update integrations set name = 'Renombrada' where id = $1", [integrationId], a.orgId),
    ).toBe(NO_FAILURE);
  });

  it('lets the API replace the sealed secret but not move it to another field or integration', async () => {
    const integrationId = await insertIntegration(a);
    await insertSecret(a, integrationId);
    for (const column of ['field', 'integration_id', 'organization_id']) {
      const outcome = await sqlState(
        app,
        `update integration_secrets set ${column} = ${column} where integration_id = $1`,
        [integrationId],
        a.orgId,
      );
      expect(outcome, column).toBe(NO_PRIVILEGE);
    }
    expect(
      await sqlState(
        app,
        'update integration_secrets set ciphertext = $2, secret_version = secret_version + 1 where integration_id = $1',
        [integrationId, CIPHERTEXT],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
  });

  it('hides the rows of another organization and rejects writing into it', async () => {
    const integrationOfA = await insertIntegration(a, { name: 'Solo de A' });
    const visibleToB = await inOrg(app, b.orgId, () =>
      app.query('select id from integrations where id = $1', [integrationOfA]),
    );
    expect(visibleToB.rowCount).toBe(0);

    const smuggled = await sqlState(
      app,
      `insert into integrations (organization_id, kind, name, created_by)
       values ($1, 'sms_pull', 'Infiltrada', $2)`,
      [a.orgId, a.rootId],
      b.orgId,
    );
    expect(smuggled).toBe(RLS_VIOLATION);
  });

  it('gives the inbound worker no access at all', async () => {
    expect(await sqlState(worker, 'select id from integrations', [], a.orgId)).toBe(NO_PRIVILEGE);
    expect(await sqlState(worker, 'select ciphertext from integration_secrets', [], a.orgId)).toBe(
      NO_PRIVILEGE,
    );
  });
});
