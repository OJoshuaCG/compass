#!/usr/bin/env -S npx tsx
/**
 * Minimal CLI:
 *   DATABASE_URL=postgres://iam_migrator:...@host/db  tsx db/src/cli.ts migrate
 *   DATABASE_URL=postgres://admin:...@host/db         tsx db/src/cli.ts bootstrap
 * The connection string comes from the environment only (injected by the secrets manager).
 */
import { bootstrapRoles } from './bootstrap.js';
import { migrate } from './migrate.js';

const [command] = process.argv.slice(2);
const connectionString = process.env['DATABASE_URL'];

if (!connectionString || (command !== 'migrate' && command !== 'bootstrap')) {
  console.error('Usage: DATABASE_URL=... tsx db/src/cli.ts <migrate|bootstrap>');
  process.exit(2);
}

try {
  if (command === 'bootstrap') {
    await bootstrapRoles({ connectionString });
    console.warn('roles provisioned');
  } else {
    const result = await migrate({
      connectionString,
      log: (m) => {
        console.warn(m);
      },
    });
    console.warn(
      `applied ${String(result.applied.length)}, already applied ${String(result.skipped.length)}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
