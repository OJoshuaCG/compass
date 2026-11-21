/**
 * Invariantes de seguridad
 * - Usa el pool del rol de migraciones: `audit_create_month_partition` no la puede ejecutar `iam_app`.
 * - No lee filas de auditoría: solo el catálogo (nombres de partición) y crea particiones vacías.
 */
import type { Pool } from 'pg';

import type { AuditPartitionAdmin } from '../application/ports/audit-partition-ports.js';

export class PgAuditPartitionAdmin implements AuditPartitionAdmin {
  constructor(private readonly pool: Pool) {}

  async lastMonthlyPartition(): Promise<string | null> {
    // Se lee del nombre `audit_events_pAAAAMM` que fija la función. Una partición hecha a mano con otro rango
    // pero con ese nombre haría fallar la creación (22023), no pasaría inadvertida.
    const result = await this.pool.query<{ month: string | null }>(
      `select to_char(
                to_date(max(substring(c.relname from '^audit_events_p([0-9]{6})$')), 'YYYYMM'),
                'YYYY-MM-DD'
              ) as month
         from pg_inherits i
         join pg_class c on c.oid = i.inhrelid
        where i.inhparent = 'public.audit_events'::regclass`,
    );
    return result.rows[0]?.month ?? null;
  }

  async createMonthPartition(month: string): Promise<string> {
    const result = await this.pool.query<{ name: string }>(
      'select audit_create_month_partition($1::date) as name',
      [month],
    );
    return result.rows[0]?.name ?? '';
  }
}
