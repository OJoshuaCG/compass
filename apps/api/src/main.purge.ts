/**
 * Purga de datos efímeros vencidos (comando de operaciones, ADR 0038). Borra las claves de
 * idempotencia y los desafíos de passkey que vencieron hace más de una hora, organización por
 * organización y bajo RLS.
 *
 * Usa la misma credencial que la API (rol `iam_app`, sin BYPASSRLS), nunca la de administración.
 * Es seguro repetirlo y correrlo mientras la API atiende: se programa por fuera (propuesta: cada
 * hora) hasta que exista el proceso de fondo (tarea H1). Sale con código distinto de cero si falla.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { PgExpiredChallengesPurger } from './modules/identity/index.js';
import { PgExpiredIdempotencyKeysPurger } from './modules/idempotency/index.js';
import { PurgeExpiredRows } from './modules/maintenance/index.js';
import { PgOrganizationLister, PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const inputSchema = z.object({ DATABASE_URL: z.string().min(1) });

const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  // Solo los nombres de las variables con problema, nunca sus valores.
  const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Missing or invalid environment: ${names}`);
}

const pool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 2 });
// La purga no usa transacciones independientes, pero la unidad de trabajo exige un pool propio.
const independentPool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 1 });
try {
  const contexts = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, contexts, independentPool);
  const report = await new PurgeExpiredRows({
    organizations: new PgOrganizationLister(pool),
    scope: new PgTenantScope(contexts, uow),
    purgers: [new PgExpiredIdempotencyKeysPurger(uow), new PgExpiredChallengesPurger(uow)],
    clock: new SystemClock(),
    ids: new UuidV7Generator(),
  }).execute();

  process.stdout.write(
    [
      `Purga terminada. Organizaciones recorridas: ${String(report.organizations)}.`,
      ...Object.entries(report.deleted).map(
        ([table, count]) => `  ${table}: ${String(count)} filas borradas`,
      ),
      '',
    ].join('\n'),
  );
} finally {
  await Promise.all([pool.end(), independentPool.end()]);
}
