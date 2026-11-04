/**
 * Ancla externa diaria de la cadena de auditoría (ADR 0042, opción B). Por cada organización registra la
 * cabeza de su cadena en `audit_anchors` y publica el manifiesto en el bucket de Wasabi con Object Lock en
 * modo de cumplimiento. Se programa una vez al día desde el cron del anfitrión (ver
 * `docs/runbooks/anchor-audit.md`).
 * Usa el rol de la aplicación (`iam_app`): el aislamiento por filas sigue vigente. Imprime solo conteos;
 * sale con código 1 si alguna organización quedó sin ancla. Nunca imprime la credencial del bucket.
 */
import { Pool } from 'pg';
import { z } from 'zod';

import {
  AnchorAuditChain,
  PgAuditAnchorLedger,
  S3AuditAnchorPublisher,
} from './modules/audit/index.js';
import { PgOrganizationLister } from './modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const inputSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUDIT_ANCHOR_S3_ENDPOINT: z.url(),
  AUDIT_ANCHOR_S3_REGION: z.string().min(1),
  AUDIT_ANCHOR_S3_BUCKET: z.string().min(1),
  AUDIT_ANCHOR_S3_ACCESS_KEY_ID: z.string().min(1),
  AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY: z.string().min(1),
});
const parsed = inputSchema.safeParse(process.env);
if (!parsed.success) {
  // Solo los nombres de las variables: nunca sus valores, que incluyen la credencial del bucket.
  const invalidNames = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Missing or invalid environment: ${invalidNames.join(', ')}`);
}
const environment = parsed.data;

const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2 });
const independentPool = new Pool({ connectionString: environment.DATABASE_URL, max: 1 });
try {
  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, requestContext, independentPool);
  const summary = await new AnchorAuditChain({
    organizations: new PgOrganizationLister(pool),
    ledger: new PgAuditAnchorLedger(uow),
    publisher: new S3AuditAnchorPublisher({
      endpoint: environment.AUDIT_ANCHOR_S3_ENDPOINT,
      region: environment.AUDIT_ANCHOR_S3_REGION,
      bucket: environment.AUDIT_ANCHOR_S3_BUCKET,
      accessKeyId: environment.AUDIT_ANCHOR_S3_ACCESS_KEY_ID,
      secretAccessKey: environment.AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY,
    }),
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock: new SystemClock(),
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; ancladas: ${String(summary.anchored)}; organizaciones con fallo: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(
      `Falló el ancla de la organización ${failure.organizationId}: ${failure.reason}\n`,
    );
  }
  if (summary.failedOrganizations.length > 0) process.exitCode = 1;
} finally {
  await pool.end();
  await independentPool.end();
}
