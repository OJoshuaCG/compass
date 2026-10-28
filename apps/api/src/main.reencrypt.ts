/**
 * Recifrado de secretos con la DEK activa tras una rotación (ADR 0040, runbook `rotate-dek`).
 * Se ejecuta a mano o desde el cron del anfitrión; es idempotente y reanudable. Usa el rol de la
 * aplicación (`iam_app`): el aislamiento por filas sigue vigente. Imprime solo conteos; sale con
 * código 1 si alguna organización falló o si quedó algún secreto en una versión anterior.
 */
import { Pool } from 'pg';

import { loadConfig } from './app/config.js';
import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from './modules/crypto/index.js';
import { PgCredentialRepository, ReencryptTotpSecrets } from './modules/identity/index.js';
import { PgOrganizationLister, ReencryptSecrets } from './modules/maintenance/index.js';
import { PgTenantScope, PgUnitOfWork } from './modules/organization/index.js';
import { AsyncLocalRequestContext } from './shared/infrastructure/async-local-request-context.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';
import { UuidV7Generator } from './shared/infrastructure/uuid-v7-generator.js';

const config = loadConfig(process.env);
if (config.DATABASE_URL === undefined) {
  throw new Error('Missing or invalid environment: DATABASE_URL');
}

const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
const independentPool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
const clock = new SystemClock();
const requestContext = new AsyncLocalRequestContext();
const uow = new PgUnitOfWork(pool, requestContext, independentPool);
const keys = new DataKeyResolver({
  repository: new PgDataKeyRepository(uow),
  kms: new LocalKeyManagement({
    keyFilePath: config.LOCAL_KMS_KEY_FILE,
    nodeEnv: config.NODE_ENV,
  }),
  cache: new DekCache({ clock }),
  clock,
  independently: <T>(fn: () => Promise<T>): Promise<T> => uow.runIndependent(fn),
});

try {
  const cipher = new SecretCipher({ keys, primitives: new NodeCryptoPrimitives() });

  const summary = await new ReencryptSecrets({
    organizations: new PgOrganizationLister(pool),
    reencryptors: [
      new ReencryptTotpSecrets({ credentials: new PgCredentialRepository(uow), cipher }),
    ],
    scope: new PgTenantScope(requestContext, uow),
    ids: new UuidV7Generator(),
    clock,
  }).execute();

  process.stdout.write(
    `Organizaciones: ${String(summary.organizations)}; secretos recifrados: ${String(summary.resealed)}; pendientes en versión anterior: ${String(summary.pending)}; organizaciones con fallo: ${String(summary.failedOrganizations.length)}\n`,
  );
  for (const failure of summary.failedOrganizations) {
    process.stderr.write(`Falló la organización ${failure.organizationId}: ${failure.reason}\n`);
  }
  if (summary.failedOrganizations.length > 0 || summary.pending > 0) process.exitCode = 1;
} finally {
  // Las DEK en memoria se borran también si el trabajo lanzó una excepción.
  keys.clearCache();
  await pool.end();
  await independentPool.end();
}
