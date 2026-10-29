/**
 * Limpieza de filas efímeras vencidas (`idempotency_keys`, `webauthn_challenges`; ADR 0038) y de las
 * versiones de secreto del segundo factor reemplazadas hace más de 30 días (H1b).
 * Se programa desde el cron del anfitrión (ver `docs/runbooks/single-instance-operation.md`).
 * Usa el rol de la aplicación (`iam_app`): el aislamiento por filas sigue vigente. Imprime solo
 * conteos; sale con código 1 si alguna organización falló.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import {
  PurgeExpiredEphemeral,
  PgExpiredEphemeralStore,
  PgOrganizationLister,
  PgReplacedTotpSecretStore,
} from './modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const inputSchema = z.object({ DATABASE_URL: z.string().min(1) });
const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Missing or invalid environment: DATABASE_URL');
}

const pool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 2 });
const independentPool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 1 });
try {
  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, requestContext, independentPool);
  const summary = await new PurgeExpiredEphemeral({
    organizations: new PgOrganizationLister(pool),
    store: new PgExpiredEphemeralStore(uow),
    replacedTotpSecrets: new PgReplacedTotpSecretStore(uow),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; claves de idempotencia borradas: ${String(summary.idempotencyKeys)}; desafíos borrados: ${String(summary.webauthnChallenges)}; versiones de segundo factor reemplazadas borradas: ${String(summary.replacedTotpSecrets)}; organizaciones con fallo: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(`Falló la organización ${failure.organizationId}: ${failure.reason}\n`);
  }
  if (summary.failedOrganizations.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
