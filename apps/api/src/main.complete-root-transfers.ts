/**
 * Proceso periódico de la transferencia de la Raíz (governance §2.4): por organización, completa la
 * transferencia cuya espera de 72 horas ya terminó, caduca la propuesta no aceptada a los 7 días y cancela
 * si la destinataria dejó de ser Administradora activa. Se programa desde el cron del anfitrión
 * (ver `docs/runbooks/transfer-root.md`). Usa el rol de la aplicación (`iam_app`): el aislamiento por filas
 * sigue vigente. Imprime solo conteos; sale con código 1 si alguna organización falló.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { RootRoleHandoverAdapter, PgRoleRepository } from './modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from './modules/audit/index.js';
import {
  CompleteRootTransfers,
  PgRootTransferNoticeQueue,
  PgRootTransferStore,
  PgUserDirectory,
  RootTransferFinalizer,
} from './modules/directory/index.js';
import {
  PgCredentialRepository,
  PgSessionRepository,
  RootAccessRevokerAdapter,
} from './modules/identity/index.js';
import { PgOrganizationLister } from './modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { PgEmergencyCodeInvalidator } from './modules/provisioning/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const inputSchema = z.object({ DATABASE_URL: z.string().min(1) });
const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Missing or invalid environment: DATABASE_URL');
}

interface OrganizationFailure {
  readonly organizationId: string;
  readonly reason: string;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}

const pool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 2 });
const independentPool = new Pool({ connectionString: parsed.data.DATABASE_URL, max: 1 });
try {
  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, requestContext, independentPool);
  const scope = new PgTenantScope(requestContext, uow);
  const ids = new UuidV7Generator();
  const clock = new SystemClock();

  // Mismo ensamblaje que el contenedor de la API: la transferencia se cierra igual a mano o por el proceso.
  const directory = new PgUserDirectory(uow);
  const store = new PgRootTransferStore(uow);
  const finalizer = new RootTransferFinalizer({
    context: requestContext,
    directory,
    swap: directory,
    roles: new RootRoleHandoverAdapter({ roles: new PgRoleRepository(uow) }),
    access: new RootAccessRevokerAdapter({
      sessions: new PgSessionRepository(uow),
      credentials: new PgCredentialRepository(uow),
    }),
    emergencyCodes: new PgEmergencyCodeInvalidator(uow),
    store,
    notices: new PgRootTransferNoticeQueue(uow),
    audit: new RecordAuditEvent({
      repository: new PgAuditEventRepository(uow),
      context: requestContext,
      ids,
    }),
    clock,
  });
  const job = new CompleteRootTransfers({ uow, directory, store, finalizer });

  const organizationIds = await new PgOrganizationLister(pool).listIds();
  const tally = { completed: 0, cancelled: 0, expired: 0, notDue: 0, none: 0 };
  const failures: OrganizationFailure[] = [];
  for (const organizationId of organizationIds) {
    try {
      const outcome = await scope.runAs(
        { organizationId, actorId: null, requestId: ids.next() },
        () => job.run(),
      );
      if (outcome === 'completed') tally.completed += 1;
      else if (outcome === 'cancelled') tally.cancelled += 1;
      else if (outcome === 'expired') tally.expired += 1;
      else if (outcome === 'not_due') tally.notDue += 1;
      else tally.none += 1;
    } catch (error) {
      // Una organización con falla no frena a las demás; el motivo se imprime sin datos de la persona.
      failures.push({ organizationId, reason: describeFailure(error) });
    }
  }

  process.stdout.write(
    `Organizaciones: ${String(organizationIds.length)}; transferencias completadas: ${String(tally.completed)}; canceladas: ${String(tally.cancelled)}; caducadas: ${String(tally.expired)}; con espera pendiente: ${String(tally.notDue)}; organizaciones con fallo: ${String(failures.length)}\n`,
  );
  for (const failure of failures) {
    process.stderr.write(`Falló la organización ${failure.organizationId}: ${failure.reason}\n`);
  }
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
