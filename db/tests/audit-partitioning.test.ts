import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { migrate } from '../src/index.js';
import { connect, createDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { TestDb, Tenant } from './helpers.js';

// SENSIBLE (revisión humana): la 0046 reestructura la tabla de auditoría (ruta protegida, ADR 0024).
// Decisión de Jor-El (2026-11-20, local o staging): `seq` ya no es único en toda la base; lo sostienen
// el índice único por partición, el candado por organización y audit_verify_chain().
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const PARTITIONING_MIGRATION = '0046_audit_events_partitioning.sql';
const MONTHS_AHEAD = 24;
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const NO_FAILURE = 'none';
const INVALID_PARAMETER = '22023';
const scratch: string[] = [];

afterAll(async () => {
  await Promise.all(scratch.map((directory) => rm(directory, { recursive: true, force: true })));
});

interface EventRow {
  id: string;
  seq: string;
  hash: string;
}

interface Converted {
  db: TestDb;
  tenant: Tenant;
  before: EventRow[];
}

const listEvents = async (client: Client, orgId: string): Promise<EventRow[]> => {
  const { rows } = await client.query<EventRow>(
    `select e.id::text as id, e.seq::text as seq, encode(e.hash, 'hex') as hash
       from audit_events e
      where e.organization_id = $1
      order by e.seq`,
    [orgId],
  );
  return rows;
};

const partitionNames = async (client: Client): Promise<string[]> => {
  const { rows } = await client.query<{ relname: string }>(
    `select c.relname
       from pg_inherits i
       join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'public.audit_events'::regclass
      order by c.relname`,
  );
  return rows.map((row) => row.relname);
};

interface FuturePartition {
  name: string;
  /** Un instante a mitad del mes de la partición, dentro de su rango. */
  midMonth: string;
}

const firstFuturePartition = async (client: Client): Promise<FuturePartition> => {
  const names = await partitionNames(client);
  const name = names.find((candidate) => candidate.startsWith('audit_events_p')) ?? '';
  expect(name).not.toBe('');
  const month = name.slice('audit_events_p'.length);
  return { name, midMonth: `${month.slice(0, 4)}-${month.slice(4, 6)}-15T12:00:00Z` };
};

const lastPartitionMonth = async (client: Client): Promise<string> => {
  const names = await partitionNames(client);
  const last = names.filter((name) => name.startsWith('audit_events_p')).at(-1) ?? '';
  const month = last.slice('audit_events_p'.length);
  return `${month.slice(0, 4)}-${month.slice(4, 6)}-01`;
};

/** Inserta una fila falsificada con seq/id dados; el encadenado debe estar apagado en la partición. */
const forgeEvent = async (
  client: Client,
  forged: { orgId: string; seq: number; id: string; createdAt: string },
): Promise<string> =>
  sqlState(
    client,
    `insert into audit_events (id, organization_id, seq, action, outcome, created_at)
     values ($1, $2, $3, 'forged', 'success', $4::timestamptz)`,
    [forged.id, forged.orgId, forged.seq, forged.createdAt],
  );

/** Aplica hasta la 0045, siembra eventos y luego aplica la 0046 sobre esos datos. */
async function convertWithPriorData(): Promise<Converted> {
  const db = await createDatabase(inject('adminUrl'));
  const directory = await mkdtemp(join(tmpdir(), 'iam-migrations-0046-'));
  scratch.push(directory);
  await cp(migrationsDir, directory, { recursive: true });
  const migrationsUnderTest = (await readdir(directory)).filter(
    (file) => file >= PARTITIONING_MIGRATION,
  );
  await Promise.all(migrationsUnderTest.map((file) => rm(join(directory, file))));
  await migrate({ connectionString: db.migratorUrl, directory });

  const tenant = await seedTenant(db.appUrl, db.adminUrl, 'before-partitioning');
  const admin = await connect(db.adminUrl);
  try {
    const before = await listEvents(admin, tenant.orgId);
    expect(before.length).toBeGreaterThan(0);
    await migrate({ connectionString: db.migratorUrl });
    return { db, tenant, before };
  } finally {
    await admin.end();
  }
}

describe('migración 0046: audit_events particionada por mes', () => {
  it('conserva cada evento, su cadena de hashes y la verificación tras convertir una base con datos', async () => {
    const { db, tenant, before } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    const app = await connect(db.appUrl);
    try {
      const kind = await admin.query<{ relkind: string }>(
        "select relkind from pg_class where oid = 'public.audit_events'::regclass",
      );
      expect(kind.rows[0]?.relkind).toBe('p');
      expect(await listEvents(admin, tenant.orgId)).toEqual(before);

      const legacy = await admin.query<{ partition: string }>(
        `select tableoid::regclass::text as partition
           from audit_events where organization_id = $1 limit 1`,
        [tenant.orgId],
      );
      expect(legacy.rows[0]?.partition).toBe('audit_events_legacy');

      const verification = await inOrg(app, tenant.orgId, () =>
        app.query<{ broken: string | null }>('select audit_verify_chain()::text as broken'),
      );
      expect(verification.rows[0]?.broken).toBeNull();

      // La cadena sigue creciendo sobre el último hash anterior a la conversión.
      await inOrg(app, tenant.orgId, () =>
        app.query(
          "insert into audit_events (organization_id, actor_id, action, outcome) values ($1, $2, 'user.invited', 'success')",
          [tenant.orgId, tenant.rootId],
        ),
      );
      const after = await listEvents(admin, tenant.orgId);
      expect(after).toHaveLength(before.length + 1);
      expect(after.slice(0, before.length)).toEqual(before);
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('crea la partición legada más 24 meses por adelantado, cada una con RLS forzado y sus dos políticas', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const names = await partitionNames(admin);
      expect(names).toContain('audit_events_legacy');
      expect(names.filter((name) => name.startsWith('audit_events_p'))).toHaveLength(MONTHS_AHEAD);

      for (const name of names) {
        const rls = await admin.query<{ enabled: boolean; forced: boolean; policies: string }>(
          `select c.relrowsecurity as enabled,
                  c.relforcerowsecurity as forced,
                  (select count(*) from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname)::text as policies
             from pg_class c
            where c.oid = format('public.%I', $1::text)::regclass`,
          [name],
        );
        expect(rls.rows[0], name).toEqual({ enabled: true, forced: true, policies: '2' });
      }
    } finally {
      await admin.end();
    }
  });

  it('cada partición tiene su índice único (organization_id, seq)', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const names = await partitionNames(admin);
      for (const name of names) {
        const unique = await admin.query<{ columns: string }>(
          `select string_agg(a.attname, ',' order by k.ord) as columns
             from pg_index i
             cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
            where i.indrelid = format('public.%I', $1::text)::regclass
              and i.indisunique
            group by i.indexrelid`,
          [name],
        );
        expect(
          unique.rows.map((row) => row.columns),
          name,
        ).toContain('organization_id,seq');
      }
    } finally {
      await admin.end();
    }
  });

  it('el índice de una partición mensual impide duplicar seq dentro de ella', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const future = await firstFuturePartition(admin);
      // Mismo (organization_id, seq) con created_at distinto: la única de (org, seq, created_at) del
      // padre no lo detecta; solo el índice propio de la partición lo hace.
      await admin.query(`alter table ${future.name} disable trigger audit_events_chain`);
      const first = await forgeEvent(admin, {
        orgId: tenant.orgId,
        seq: 5000,
        id: randomUUID(),
        createdAt: future.midMonth,
      });
      const second = await forgeEvent(admin, {
        orgId: tenant.orgId,
        seq: 5000,
        id: randomUUID(),
        createdAt: future.midMonth.replace('T12', 'T13'),
      });
      expect([first, second]).toEqual([NO_FAILURE, UNIQUE_VIOLATION]);
    } finally {
      await admin.end();
    }
  });

  it('el índice de una partición mensual impide duplicar id dentro de ella', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const future = await firstFuturePartition(admin);
      await admin.query(`alter table ${future.name} disable trigger audit_events_chain`);
      const repeatedId = randomUUID();
      const first = await forgeEvent(admin, {
        orgId: tenant.orgId,
        seq: 5001,
        id: repeatedId,
        createdAt: future.midMonth,
      });
      const second = await forgeEvent(admin, {
        orgId: tenant.orgId,
        seq: 5002,
        id: repeatedId,
        createdAt: future.midMonth.replace('T12', 'T13'),
      });
      expect([first, second]).toEqual([NO_FAILURE, UNIQUE_VIOLATION]);
    } finally {
      await admin.end();
    }
  });

  it('el índice de la partición legada impide duplicar seq dentro de ella', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      await admin.query('alter table audit_events_legacy disable trigger audit_events_chain');
      const state = await sqlState(
        admin,
        // created_at distinto: así la única heredada (organization_id, seq, created_at) no lo detecta
        // y solo puede fallar el índice propio (organization_id, seq) de la partición legada.
        `insert into audit_events (organization_id, seq, action, outcome, created_at)
         select organization_id, seq, 'forged', 'success', created_at - interval '1 second'
           from audit_events where organization_id = $1 order by seq limit 1`,
        [tenant.orgId],
      );
      expect(state).toBe(UNIQUE_VIOLATION);
    } finally {
      await admin.end();
    }
  });

  it('un seq duplicado entre dos particiones, con hash válido, lo detecta audit_verify_chain()', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    const app = await connect(db.appUrl);
    try {
      const future = await firstFuturePartition(admin);
      const lastEvent = await admin.query<{ seq: string }>(
        'select max(seq)::text as seq from audit_events where organization_id = $1',
        [tenant.orgId],
      );
      const duplicatedSeq = lastEvent.rows[0]?.seq ?? '';

      // El índice único de la partición nueva no ve el seq de la partición legada: nada lo impide en
      // la base. La fila lleva prev_hash y hash correctos, así que el único defecto es el seq repetido
      // y solo la verificación de la cadena puede delatarlo.
      await admin.query(`alter table ${future.name} disable trigger audit_events_chain`);
      await admin.query(
        `with last_event as (
           select e.hash, e.seq from audit_events e
            where e.organization_id = $1 order by e.seq desc limit 1
         ), new_event as (select uuid_generate_v7() as id)
         insert into audit_events (id, organization_id, seq, action, outcome, prev_hash, hash, created_at)
         select n.id, $1, l.seq, 'forged', 'success', l.hash,
                audit_event_hash(l.hash, $1, l.seq, n.id, $2::timestamptz, null, 'forged', null, null,
                                 'success', null, null, null, '{}'::jsonb),
                $2::timestamptz
           from last_event l cross join new_event n`,
        [tenant.orgId, future.midMonth],
      );

      const verification = await inOrg(app, tenant.orgId, () =>
        app.query<{ broken: string | null }>('select audit_verify_chain()::text as broken'),
      );
      expect(verification.rows[0]?.broken).toBe(duplicatedSeq);
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('mantiene la auditoría de solo anexar: UPDATE, DELETE y TRUNCATE siguen rechazados, también en cada partición', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    const app = await connect(db.appUrl);
    try {
      expect(await sqlState(app, "update audit_events set action = 'x'", [], tenant.orgId)).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      await expect(admin.query("update audit_events set action = 'x'")).rejects.toThrow(
        /append-only/,
      );
      await expect(admin.query('delete from audit_events')).rejects.toThrow(/append-only/);
      await expect(admin.query('truncate audit_events')).rejects.toThrow(/append-only/);
      for (const name of await partitionNames(admin)) {
        await expect(admin.query(`truncate ${name}`), name).rejects.toThrow(/append-only/);
      }
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('cada partición clonó los disparadores de encadenado y de solo anexar, habilitados', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const result = await admin.query<{ partition: string; triggers: string }>(
        `select c.relname as partition,
                string_agg(t.tgname, ',' order by t.tgname) as triggers
           from pg_inherits i
           join pg_class c on c.oid = i.inhrelid
           join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled = 'O'
          where i.inhparent = 'public.audit_events'::regclass
          group by c.relname`,
      );
      const expectedTriggers =
        'audit_events_chain,audit_events_no_truncate,audit_events_no_update_delete';
      expect(result.rows.length).toBe(25);
      for (const row of result.rows) {
        expect(row.triggers, row.partition).toBe(expectedTriggers);
      }
    } finally {
      await admin.end();
    }
  });

  it('UPDATE y DELETE de una fila ya escrita en una partición mensual siguen rechazados', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const future = await firstFuturePartition(admin);
      await admin.query(`alter table ${future.name} disable trigger audit_events_chain`);
      const inserted = await forgeEvent(admin, {
        orgId: tenant.orgId,
        seq: 7000,
        id: randomUUID(),
        createdAt: future.midMonth,
      });
      expect(inserted).toBe(NO_FAILURE);
      await expect(admin.query(`update ${future.name} set action = 'x'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(admin.query(`delete from ${future.name}`)).rejects.toThrow(/append-only/);
    } finally {
      await admin.end();
    }
  });

  it('iam_app solo llega a los eventos por la tabla padre, nunca directo a una partición', async () => {
    const { db, tenant } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    const app = await connect(db.appUrl);
    try {
      for (const name of await partitionNames(admin)) {
        expect(await sqlState(app, `select count(*) from ${name}`, [], tenant.orgId), name).toBe(
          INSUFFICIENT_PRIVILEGE,
        );
        expect(
          await sqlState(
            app,
            `insert into ${name} (organization_id, action, outcome) values ($1, 'x', 'success')`,
            [tenant.orgId],
            tenant.orgId,
          ),
          name,
        ).toBe(INSUFFICIENT_PRIVILEGE);
      }
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('audit_create_month_partition es idempotente para un mes ya creado y rechaza un mes cubierto por la partición legada', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const names = await partitionNames(admin);
      const lastMonth = await lastPartitionMonth(admin);
      const again = await admin.query<{ name: string }>(
        'select audit_create_month_partition($1::date) as name',
        [lastMonth],
      );
      expect(again.rows[0]?.name).toBe(`audit_events_p${lastMonth.slice(0, 7).replace('-', '')}`);

      const currentMonth = await admin.query<{ month: string }>(
        "select to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY-MM-DD') as month",
      );
      expect(
        await sqlState(admin, 'select audit_create_month_partition($1::date)', [
          currentMonth.rows[0]?.month,
        ]),
      ).toBe(INVALID_PARAMETER);
      expect(await partitionNames(admin)).toEqual(names);
    } finally {
      await admin.end();
    }
  });

  it('audit_create_month_partition rechaza un nombre ocupado por una tabla que no es la partición adjunta de ese mes', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const lastMonth = await lastPartitionMonth(admin);
      const squatted = await admin.query<{ month: string; name: string }>(
        `select to_char(($1::date + interval '1 month'), 'YYYY-MM-DD') as month,
                'audit_events_p' || to_char(($1::date + interval '1 month'), 'YYYYMM') as name`,
        [lastMonth],
      );
      const month = squatted.rows[0]?.month ?? '';
      const name = squatted.rows[0]?.name ?? '';

      // Una tabla común con el nombre esperado, fuera de audit_events.
      await admin.query(`create table ${name} (id integer)`);
      expect(await sqlState(admin, 'select audit_create_month_partition($1::date)', [month])).toBe(
        INVALID_PARAMETER,
      );
      await admin.query(`drop table ${name}`);

      // Una partición separada (DETACH) de audit_events: tampoco cuenta como el mes cubierto.
      await admin.query(`select audit_create_month_partition('${month}')`);
      await admin.query(`alter table audit_events detach partition ${name}`);
      expect(await sqlState(admin, 'select audit_create_month_partition($1::date)', [month])).toBe(
        INVALID_PARAMETER,
      );
    } finally {
      await admin.end();
    }
  });

  it('audit_create_month_partition rechaza una partición con el nombre del mes pero otro rango', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const lastMonth = await lastPartitionMonth(admin);
      const wrongRange = await admin.query<{
        month: string;
        name: string;
        start: string;
        end: string;
      }>(
        `select to_char(($1::date + interval '1 month'), 'YYYY-MM-DD') as month,
                'audit_events_p' || to_char(($1::date + interval '1 month'), 'YYYYMM') as name,
                to_char(($1::date + interval '2 month'), 'YYYY-MM-DD') as start,
                to_char(($1::date + interval '3 month'), 'YYYY-MM-DD') as end`,
        [lastMonth],
      );
      const row = wrongRange.rows[0];
      const name = row?.name ?? '';
      const rangeStart = row?.start ?? '';
      const rangeEnd = row?.end ?? '';
      // Misma etiqueta de mes en el nombre, pero cubre otro mes.
      await admin.query(
        `create table ${name} partition of audit_events
           for values from ('${rangeStart}+00') to ('${rangeEnd}+00')`,
      );
      expect(
        await sqlState(admin, 'select audit_create_month_partition($1::date)', [row?.month]),
      ).toBe(INVALID_PARAMETER);
    } finally {
      await admin.end();
    }
  });

  it('audit_create_month_partition reconoce una partición existente aunque la sesión use otra zona horaria', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      const lastMonth = await lastPartitionMonth(admin);
      await admin.query("set time zone 'America/Mexico_City'");
      const again = await admin.query<{ name: string }>(
        'select audit_create_month_partition($1::date) as name',
        [lastMonth],
      );
      expect(again.rows[0]?.name).toBe(`audit_events_p${lastMonth.slice(0, 7).replace('-', '')}`);
    } finally {
      await admin.end();
    }
  });

  it('audit_create_month_partition exige el primer día del mes y no la ejecuta iam_app', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    const app = await connect(db.appUrl);
    try {
      const lastMonth = await lastPartitionMonth(admin);
      expect(await sqlState(admin, "select audit_create_month_partition('2031-03-15')")).toBe(
        INVALID_PARAMETER,
      );
      expect(await sqlState(app, `select audit_create_month_partition('${lastMonth}')`)).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('una partición creada después de la migración nace con RLS forzado, dos políticas, únicos y sin permisos para iam_app aunque haya privilegios por omisión', async () => {
    const { db } = await convertWithPriorData();
    const admin = await connect(db.adminUrl);
    try {
      // Simula un entorno donde el esquema concede por omisión acceso a iam_app: la función debe
      // quitarlo de la partición nueva.
      await admin.query(
        'alter default privileges in schema public grant select, insert on tables to iam_app',
      );
      const lastMonth = await lastPartitionMonth(admin);
      const created = await admin.query<{ name: string }>(
        "select audit_create_month_partition(($1::date + interval '1 month')::date) as name",
        [lastMonth],
      );
      const name = created.rows[0]?.name ?? '';
      expect(await partitionNames(admin)).toContain(name);

      const state = await admin.query<{
        forced: boolean;
        policies: string;
        unique_indexes: string;
        can_select: boolean;
        can_insert: boolean;
      }>(
        `select c.relrowsecurity and c.relforcerowsecurity as forced,
                (select count(*) from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname)::text as policies,
                (select count(*) from pg_index i
                  where i.indrelid = c.oid and i.indisunique and not i.indisprimary)::text as unique_indexes,
                has_table_privilege('iam_app', c.oid, 'SELECT') as can_select,
                has_table_privilege('iam_app', c.oid, 'INSERT') as can_insert
           from pg_class c
          where c.oid = format('public.%I', $1::text)::regclass`,
        [name],
      );
      // Únicos no primarios: (organization_id, seq, created_at) heredado, (organization_id, seq) e (id).
      expect(state.rows[0]).toEqual({
        forced: true,
        policies: '2',
        unique_indexes: '3',
        can_select: false,
        can_insert: false,
      });
    } finally {
      await admin.end();
    }
  });
});
