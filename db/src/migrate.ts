import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { MigrationChecksumError, MigrationOrderError } from './errors.js';

export interface MigrateOptions {
  /** Connection string of the migrations role (iam_migrator), the owner of every table. */
  connectionString: string;
  /** Directory with `NNNN_name.sql` files. Defaults to the package's `migrations/`. */
  directory?: string | URL;
  /** Progress sink; defaults to silent. */
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

interface MigrationFile {
  name: string;
  version: string;
  sql: string;
  checksum: string;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
}

const FILE_PATTERN = /^(\d{4,})_[a-z0-9_]+\.sql$/;
// Arbitrary constant: serializes concurrent runners (two deploys, one database).
const LOCK_KEY = 7_283_461_901;

const defaultDirectory = new URL('../migrations/', import.meta.url);

/**
 * Huella SHA-256 del SQL para detectar migraciones aplicadas que se editaron después. Es una
 * verificación de integridad sobre texto público, no cifra ni protege ningún secreto: por eso esta
 * importación de `node:crypto` queda fuera de la regla "solo el módulo de criptografía" (C6).
 */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

async function loadFiles(directory: string | URL): Promise<MigrationFile[]> {
  const dir = typeof directory === 'string' ? directory : fileURLToPath(directory);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const match = FILE_PATTERN.exec(name);
    if (!match?.[1]) {
      throw new MigrationOrderError(
        `Invalid migration file name: ${name} (expected NNNN_snake_case.sql)`,
      );
    }
    const sql = await readFile(`${dir.replace(/\/$/, '')}/${name}`, 'utf8');
    files.push({ name, version: match[1], sql, checksum: checksumOf(sql) });
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.version)) {
      throw new MigrationOrderError(`Duplicate migration version ${f.version}`);
    }
    seen.add(f.version);
  }
  return files;
}

/**
 * Applies pending migrations in order, each in its own transaction together with its
 * `schema_migrations` row, so a failure leaves no half-applied file. Refuses to run when an
 * applied file changed, disappeared, or a new file sorts before an applied one.
 */
export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const files = await loadFiles(options.directory ?? defaultDirectory);
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`
        create table if not exists schema_migrations (
          version    text primary key,
          name       text not null unique,
          checksum   text not null check (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz not null default now()
        )`);
      const { rows } = await client.query<AppliedRow>(
        'select version, name, checksum from schema_migrations order by version',
      );
      const appliedByVersion = new Map(rows.map((r) => [r.version, r]));
      const fileVersions = new Set(files.map((f) => f.version));

      for (const row of rows) {
        if (!fileVersions.has(row.version)) {
          throw new MigrationOrderError(
            `Migration ${row.name} was applied but its file is missing. Restore it; applied migrations are never deleted.`,
          );
        }
      }
      for (const file of files) {
        const row = appliedByVersion.get(file.version);
        if (row && row.checksum !== file.checksum) {
          throw new MigrationChecksumError(file.name, row.checksum, file.checksum);
        }
      }
      const lastApplied = rows.at(-1)?.version;
      const pending = files.filter((f) => !appliedByVersion.has(f.version));
      const outOfOrder = pending.find((f) => lastApplied !== undefined && f.version < lastApplied);
      if (outOfOrder) {
        throw new MigrationOrderError(
          `Migration ${outOfOrder.name} sorts before the last applied version ${String(lastApplied)}. Use a higher number.`,
        );
      }

      const result: MigrateResult = {
        applied: [],
        skipped: files.filter((f) => appliedByVersion.has(f.version)).map((f) => f.name),
      };
      for (const file of pending) {
        log(`applying ${file.name}`);
        await client.query('begin');
        try {
          await client.query(file.sql);
          await client.query(
            'insert into schema_migrations (version, name, checksum) values ($1, $2, $3)',
            [file.version, file.name, file.checksum],
          );
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw new Error(
            `Migration ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            {
              cause: error,
            },
          );
        }
        result.applied.push(file.name);
      }
      return result;
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}
