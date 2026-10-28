import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant } from './helpers.js';
import type { Tenant } from './helpers.js';

// Medición pendiente del ADR 0036: latencia del listado de cuentas visibles para una persona cuando
// el acceso efectivo se calcula en SQL con la vista `effective_access`. Umbrales del ADR: hasta
// 150 ms es aceptable; por encima de 300 ms se abre la decisión de materializar el acceso efectivo.
// Corre en un contenedor local: sirve para detectar un plan malo, no para dimensionar capacidad.

const ACCOUNT_COUNT = 5_000;
const GROUP_COUNT = 200;
/** La persona medida pertenece a los grupos 1..GROUPS_OF_MEASURED_USER (cada grupo da acceso a ~25 cuentas). */
const GROUPS_OF_MEASURED_USER = 10;
const DIRECT_SHARES_OF_MEASURED_USER = 250;
const PAGE_SIZE = 50;
const SAMPLES_PER_SCENARIO = 40;
const MATERIALIZATION_P95_MS = 300;
const MEASUREMENT_TEST_TIMEOUT_MS = 180_000;
const LATENCY_REPORT_PATH = join(tmpdir(), 'compass-accounts-listing-latency.json');
const MIN_UUID = '00000000-0000-0000-0000-000000000000';

let appUrl = '';
let adminUrl = '';

/** Percentil por rango más cercano sobre una muestra ya ordenada de menor a mayor. */
function percentile(sortedSamples: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sortedSamples.length);
  const index = Math.min(sortedSamples.length - 1, Math.max(0, rank - 1));
  return sortedSamples[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Misma consulta que `PgAccountRepository.listVisiblePage`, con o sin cursor. */
function visibleAccountsQuery(withCursor: boolean): string {
  const afterClause = withCursor ? 'and (lower(a.display_name), a.id) > ($2::text, $3::uuid)' : '';
  const limitParameter = withCursor ? '$4' : '$2';
  return `select a.id, a.platform_id, a.display_name, a.handle, a.owner_group_id, a.tags,
                 a.status, a.created_by, a.created_at, ea.level as my_level
            from accounts a
            join effective_access ea
              on ea.organization_id = a.organization_id
             and ea.resource_type = 'account'
             and ea.resource_id = a.id
             and ea.user_id = $1
           where a.status = 'active' ${afterClause}
           order by lower(a.display_name), a.id
           limit ${limitParameter}`;
}

/**
 * Siembra un volumen realista: 5 000 cuentas, 200 grupos y ~20 000 comparticiones vivas. La persona
 * medida (Operador) ve ~500 cuentas: 250 por comparticiones directas y ~250 por 10 grupos. El resto de
 * las comparticiones pertenece a la Raíz, al administrador y a grupos a los que no pertenece.
 */
async function seedVolume(client: Client, tenant: Tenant): Promise<void> {
  const { orgId, rootId, adminId, operatorId, platformId } = tenant;
  await inOrg(client, orgId, async () => {
    await client.query(
      `insert into accounts (organization_id, platform_id, display_name, created_by)
       select $1, $2, 'Account ' || lpad(n::text, 5, '0'), $3
         from generate_series(1, $4::int) as n`,
      [orgId, platformId, rootId, ACCOUNT_COUNT],
    );
    await client.query(
      `insert into groups (organization_id, name, created_by)
       select $1, 'Bench group ' || lpad(n::text, 3, '0'), $2
         from generate_series(1, $3::int) as n`,
      [orgId, rootId, GROUP_COUNT],
    );
    // Se numeran los grupos y las cuentas por orden de nombre para que el reparto sea determinista.
    await client.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       select $1, g.id, $2, 'member', $3
         from (select id, row_number() over (order by name) as position
                 from groups where organization_id = $1 and name like 'Bench group %') g
        where g.position <= $4::int`,
      [orgId, operatorId, rootId, GROUPS_OF_MEASURED_USER],
    );
    await client.query(
      `insert into group_memberships (organization_id, group_id, user_id, role, added_by)
       select $1, g.id, $2, 'member', $3
         from groups g
        where g.organization_id = $1 and g.name like 'Bench group %'`,
      [orgId, adminId, rootId],
    );
    await client.query(
      `with numbered_accounts as (
         select id, row_number() over (order by display_name) as position
           from accounts where organization_id = $1 and display_name like 'Account %'
       ), numbered_groups as (
         select id, row_number() over (order by name) as position
           from groups where organization_id = $1 and name like 'Bench group %'
       )
       insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
       select $1::uuid, 'account', a.id, 'user', $2::uuid, 'VIEW', $3::uuid
         from numbered_accounts a
        where a.position > $5::int and a.position <= $5::int + $6::int
       union all
       select $1::uuid, 'account', a.id, 'user', $3::uuid, 'MANAGE', $3::uuid
         from numbered_accounts a
       union all
       select $1::uuid, 'account', a.id, 'user', $4::uuid, 'EDIT', $3::uuid
         from numbered_accounts a
       union all
       select $1::uuid, 'account', a.id, 'group', g.id, 'VIEW', $3::uuid
         from numbered_accounts a
         join numbered_groups g on g.position = (a.position % $7::int) + 1
       union all
       select $1::uuid, 'account', a.id, 'group', g.id, 'EDIT', $3::uuid
         from numbered_accounts a
         join numbered_groups g on g.position = ((a.position + 97) % ($7::int - 10)) + 11
       on conflict do nothing`,
      [
        orgId,
        operatorId,
        rootId,
        adminId,
        ACCOUNT_COUNT - DIRECT_SHARES_OF_MEASURED_USER,
        DIRECT_SHARES_OF_MEASURED_USER,
        GROUP_COUNT,
      ],
    );
  });

  // Sin estadísticas frescas el planificador elegiría con tablas "vacías" y la medición no valdría.
  const admin = await connect(adminUrl);
  try {
    await admin.query('analyze accounts, shares, groups, group_memberships');
  } finally {
    await admin.end();
  }
}

interface ScenarioSummary {
  readonly scenario: string;
  readonly visibleAccounts: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

async function measure(
  client: Client,
  tenant: Tenant,
  scenario: string,
  sql: string,
  params: readonly unknown[],
): Promise<ScenarioSummary> {
  const samples: number[] = [];
  let returnedRows = 0;
  for (let iteration = 0; iteration < SAMPLES_PER_SCENARIO; iteration += 1) {
    const startedAt = performance.now();
    const rows = await inOrg(client, tenant.orgId, async () => {
      const result = await client.query(sql, [...params]);
      return result.rows.length;
    });
    samples.push(performance.now() - startedAt);
    returnedRows = rows;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    scenario,
    visibleAccounts: returnedRows,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

describe('visible accounts listing latency (ADR 0036)', () => {
  const summaries: ScenarioSummary[] = [];
  let tenant: Tenant;
  let client: Client;

  beforeAll(async () => {
    const db = await createMigratedDatabase(inject('adminUrl'));
    appUrl = db.appUrl;
    adminUrl = db.adminUrl;
    tenant = await seedTenant(appUrl, adminUrl, 'listing');
    client = await connect(appUrl);
    await seedVolume(client, tenant);
  }, MEASUREMENT_TEST_TIMEOUT_MS);

  afterAll(async () => {
    // El reporter de vitest oculta la consola de las pruebas que pasan, así que el resultado se deja
    // en un archivo temporal para copiarlo al ADR 0036. No se escribe dentro del repositorio.
    await writeFile(LATENCY_REPORT_PATH, JSON.stringify(summaries, null, 2), 'utf8');
    await client.end();
  });

  it('shows the measured person about 500 accounts and no more', async () => {
    const total = await inOrg(client, tenant.orgId, () =>
      client.query<{ visible: string }>(
        `select count(*)::text as visible
           from accounts a
           join effective_access ea
             on ea.organization_id = a.organization_id and ea.resource_type = 'account'
            and ea.resource_id = a.id and ea.user_id = $1
          where a.status = 'active'`,
        [tenant.operatorId],
      ),
    );
    const visible = Number(total.rows[0]?.visible);
    summaries.push({
      scenario: 'visible accounts for the measured person',
      visibleAccounts: visible,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    });
    expect(visible).toBeGreaterThanOrEqual(400);
    expect(visible).toBeLessThanOrEqual(600);
  });

  it(
    'keeps the first page and a deep page under the materialization threshold',
    async () => {
      const firstPage = await measure(client, tenant, 'first page', visibleAccountsQuery(false), [
        tenant.operatorId,
        PAGE_SIZE,
      ]);
      const deepPage = await measure(
        client,
        tenant,
        'page after the middle of the catalog',
        visibleAccountsQuery(true),
        [tenant.operatorId, 'account 02500', MIN_UUID, PAGE_SIZE],
      );
      summaries.push(firstPage, deepPage);

      // Entre 150 y 300 ms es aceptable con vigilancia; más de 300 ms obliga a decidir la materialización.
      expect(firstPage.p95Ms).toBeLessThan(MATERIALIZATION_P95_MS);
      expect(deepPage.p95Ms).toBeLessThan(MATERIALIZATION_P95_MS);
    },
    MEASUREMENT_TEST_TIMEOUT_MS,
  );
});
