import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  MigrationChecksumError,
  MigrationOrderError,
  bootstrapRoles,
  migrate,
} from '../src/index.js';
import { connect, createDatabase } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const scratch: string[] = [];

async function copyMigrations(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'iam-migrations-'));
  scratch.push(dir);
  await cp(migrationsDir, dir, { recursive: true });
  return dir;
}

afterAll(async () => {
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

describe('migration runner', () => {
  const adminUrl = inject('adminUrl');

  it('applies every migration cleanly and is idempotent', async () => {
    const db = await createDatabase(adminUrl);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    const first = await migrate({ connectionString: db.migratorUrl });
    expect(first.applied).toEqual(files);
    expect(first.skipped).toEqual([]);

    const second = await migrate({ connectionString: db.migratorUrl });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(files);

    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query<{ version: string; checksum: string }>(
        'select version, checksum from schema_migrations order by version',
      );
      expect(rows.map((r) => r.version)).toEqual(files.map((f) => f.slice(0, 4)));
      for (const row of rows) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await admin.end();
    }
  });

  it('rejects a changed checksum of an applied migration without touching the database', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await copyMigrations();
    await migrate({ connectionString: db.migratorUrl, directory: dir });

    const target = join(dir, '0002_organizations_identity.sql');
    await writeFile(target, `${await readFile(target, 'utf8')}\n-- sneaky edit\n`);

    const run = migrate({ connectionString: db.migratorUrl, directory: dir });
    await expect(run).rejects.toBeInstanceOf(MigrationChecksumError);
    await expect(run).rejects.toThrow(/0002_organizations_identity\.sql.*never edited/s);
  });

  it('rejects an applied migration whose file disappeared', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await copyMigrations();
    await migrate({ connectionString: db.migratorUrl, directory: dir });
    await rm(join(dir, '0008_auth_functions.sql'));
    await expect(
      migrate({ connectionString: db.migratorUrl, directory: dir }),
    ).rejects.toBeInstanceOf(MigrationOrderError);
  });

  it('rejects a new migration numbered before an applied one', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await copyMigrations();
    await migrate({ connectionString: db.migratorUrl, directory: dir });
    await writeFile(join(dir, '0000_late_arrival.sql'), 'select 1;\n');
    await expect(migrate({ connectionString: db.migratorUrl, directory: dir })).rejects.toThrow(
      /sorts before the last applied version/,
    );
  });

  it('rolls back a failing migration entirely and records nothing for it', async () => {
    const db = await createDatabase(adminUrl);
    const dir = await copyMigrations();
    await migrate({ connectionString: db.migratorUrl, directory: dir });
    await writeFile(
      join(dir, '0009_broken.sql'),
      'create table half_done (id int);\nselect 1/0;\n',
    );

    await expect(migrate({ connectionString: db.migratorUrl, directory: dir })).rejects.toThrow(
      /0009_broken\.sql failed/,
    );

    const admin = await connect(db.adminUrl);
    try {
      const table = await admin.query("select to_regclass('public.half_done') as t");
      expect((table.rows[0] as { t: string | null }).t).toBeNull();
      const recorded = await admin.query("select 1 from schema_migrations where version = '0009'");
      expect(recorded.rowCount).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('fails with an actionable message when the roles were never bootstrapped', async () => {
    // Fresh cluster state cannot be recreated (roles are cluster-wide), so verify the guard
    // by running the first migration's check against a role name that does not exist.
    const db = await createDatabase(adminUrl);
    const admin = await connect(db.adminUrl);
    try {
      const sql = (
        await readFile(join(migrationsDir, '0001_base_roles_functions.sql'), 'utf8')
      ).replaceAll('iam_auth_reader', 'iam_does_not_exist');
      await expect(admin.query(sql)).rejects.toThrow(/missing database roles/);
    } finally {
      await admin.end();
    }
  });
});

describe('roles and ownership', () => {
  const adminUrl = inject('adminUrl');

  it('keeps iam_app a non-owner without BYPASSRLS and the migrator as owner of every table', async () => {
    const db = await createDatabase(adminUrl);
    await migrate({ connectionString: db.migratorUrl });
    const admin = await connect(db.adminUrl);
    try {
      const roles = await admin.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
        rolcreaterole: boolean;
      }>(
        "select rolname, rolbypassrls, rolsuper, rolcreaterole from pg_roles where rolname in ('iam_app','iam_migrator','iam_auth_reader')",
      );
      expect(roles.rowCount).toBe(3);
      for (const r of roles.rows) {
        expect(r.rolbypassrls, r.rolname).toBe(false);
        expect(r.rolsuper, r.rolname).toBe(false);
        expect(r.rolcreaterole, r.rolname).toBe(false);
      }
      const owners = await admin.query<{ tableowner: string }>(
        "select distinct tableowner from pg_tables where schemaname = 'public'",
      );
      expect(owners.rows.map((r) => r.tableowner)).toEqual(['iam_migrator']);
    } finally {
      await admin.end();
    }
  });
});

describe('role bootstrap', () => {
  it('is idempotent', async () => {
    const db = await createDatabase(inject('adminUrl'));
    await bootstrapRoles({ connectionString: db.adminUrl });
    await bootstrapRoles({ connectionString: db.adminUrl });
    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query<{ n: string }>(
        "select count(*)::text as n from pg_roles where rolname in ('iam_app','iam_migrator','iam_auth_reader')",
      );
      expect(rows[0]?.n).toBe('3');
    } finally {
      await admin.end();
    }
  });
});
