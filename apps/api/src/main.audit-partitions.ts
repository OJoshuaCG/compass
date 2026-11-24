/**
 * Mantenimiento de las particiones mensuales de `audit_events` (ADR 0024): deja creados los meses por delante
 * (24) y avisa si el margen ya era menor de 6 meses. No se programa solo: el cron lo decide Ops (ver
 * `docs/runbooks/audit-partitions.md`).
 * Usa el rol de MIGRACIONES (`MIGRATION_DATABASE_URL`), nunca `iam_app`: la función que crea la partición no se le
 * concede. Imprime solo conteos y meses; sale con código 1 si falló crear un mes o el margen previo era menor al
 * mínimo. Nunca imprime la cadena de conexión.
 */
import { Pool } from 'pg';

import { EnsureAuditPartitions, PgAuditPartitionAdmin } from './modules/audit/index.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';

const connectionString = process.env['MIGRATION_DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  throw new Error('Missing or invalid environment: MIGRATION_DATABASE_URL');
}

const pool = new Pool({ connectionString, max: 1 });
try {
  const summary = await new EnsureAuditPartitions({
    admin: new PgAuditPartitionAdmin(pool),
    clock: new SystemClock(),
  }).execute();

  process.stdout.write(
    `Particiones creadas: ${String(summary.createdMonths.length)}; margen antes: ${String(summary.runwayBeforeMonths)} meses; margen ahora: ${String(summary.runwayAfterMonths)} meses\n`,
  );
  if (summary.lowRunway) {
    process.stderr.write(
      `ALERTA: el margen previo (${String(summary.runwayBeforeMonths)} meses) estaba por debajo del mínimo; el trabajo programado se atrasó\n`,
    );
  }
  if (summary.failure !== null) {
    process.stderr.write(`Falló la creación de una partición: ${summary.failure}\n`);
  }
  if (summary.lowRunway || summary.failure !== null) process.exitCode = 1;
} finally {
  await pool.end();
}
