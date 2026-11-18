/**
 * Revisa si hay eventos del outbox en cuarentena y, de haberlos, encola la alerta `events_quarantined` para
 * la Raíz (máximo una por día y organización). Se programa desde el cron del anfitrión, por ejemplo cada
 * 15 minutos. Usa el rol de la aplicación (`iam_app`): el aislamiento por filas sigue vigente. Imprime solo
 * conteos; sale con código 1 si alguna organización falló o si la base de datos no responde.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import {
  PgInfrastructureAlertHistory,
  PgInfrastructureAlertQueue,
} from './modules/integrations/index.js';
import {
  CheckQuarantinedEvents,
  PgOrganizationLister,
  PgQuarantinedEventCounter,
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
  const alertQueue = new PgInfrastructureAlertQueue(uow);
  const alertHistory = new PgInfrastructureAlertHistory(uow);
  const summary = await new CheckQuarantinedEvents({
    organizations: new PgOrganizationLister(pool),
    counter: new PgQuarantinedEventCounter(uow),
    history: {
      hasQuarantineAlertSince: (since) => alertHistory.hasAlertSince('events_quarantined', since),
    },
    alerter: {
      alertQuarantinedEvents: (occurredAt) =>
        alertQueue.enqueue({ code: 'events_quarantined', occurredAt }),
    },
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; con eventos en cuarentena: ${String(summary.organizationsWithQuarantinedEvents)}; alertas encoladas: ${String(summary.alertsEnqueued)}; organizaciones con fallo: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(`Falló la organización ${failure.organizationId}: ${failure.reason}\n`);
  }
  if (summary.failedOrganizations.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
