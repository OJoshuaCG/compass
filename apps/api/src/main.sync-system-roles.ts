/**
 * Sincroniza los roles de sistema de las organizaciones existentes con las plantillas vigentes
 * (`SYSTEM_ROLES`, decisión B5a). Hay que correrlo una vez por despliegue que cambie las plantillas
 * (ver `docs/runbooks/provision-organization.md`); es idempotente.
 * Usa el rol de la aplicación (`iam_app`): el aislamiento por filas sigue vigente y cada cambio queda
 * auditado sin actor. Imprime solo conteos; sale con código 1 si alguna organización falló.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { SYSTEM_ROLES } from './modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from './modules/audit/index.js';
import {
  PgOrganizationLister,
  PgSystemRoleStore,
  SyncSystemRoles,
} from './modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
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
  const ids = new UuidV7Generator();
  const summary = await new SyncSystemRoles({
    organizations: new PgOrganizationLister(pool),
    store: new PgSystemRoleStore(uow),
    audit: new RecordAuditEvent({
      repository: new PgAuditEventRepository(uow),
      context: requestContext,
      ids,
    }),
    scope: new PgTenantScope(requestContext, uow),
    ids,
    templates: SYSTEM_ROLES,
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; roles de sistema actualizados: ${String(summary.rolesUpdated)}; organizaciones con fallo: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(`Falló la organización ${failure.organizationId}: ${failure.reason}\n`);
  }
  if (summary.failedOrganizations.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
