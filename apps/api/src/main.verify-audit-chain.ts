/**
 * Verificación de solo lectura de la cadena de auditoría de cada organización (`audit_verify_chain`, ADR 0024).
 * No se programa solo: el cron diario lo decide Ops (ver `docs/runbooks/audit-partitions.md`).
 * Usa el rol de la aplicación (`iam_app`): el aislamiento por filas sigue vigente. No escribe nada. Imprime solo
 * conteos, identificadores opacos de organización y el `seq` de la primera ruptura; nunca hashes ni contenido.
 * Sale con código 1 si alguna cadena está rota o alguna organización no se pudo verificar.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import { PgAuditEventRepository, VerifyAuditChains } from './modules/audit/index.js';
import { PgOrganizationLister } from './modules/maintenance/index.js';
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
  const summary = await new VerifyAuditChains({
    organizations: new PgOrganizationLister(pool),
    repository: new PgAuditEventRepository(uow),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; cadenas válidas: ${String(summary.valid)}; cadenas rotas: ${String(summary.brokenChains.length)}; organizaciones sin verificar: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const broken of summary.brokenChains) {
    process.stderr.write(
      `Cadena rota en la organización ${broken.organizationId}: primer seq ${String(broken.firstBrokenSeq)}\n`,
    );
  }
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(
      `No se pudo verificar la organización ${failure.organizationId}: ${failure.reason}\n`,
    );
  }
  if (summary.brokenChains.length > 0 || summary.failedOrganizations.length > 0)
    process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
