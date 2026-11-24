/**
 * Administración de las particiones mensuales de `audit_events` (ADR 0024). Los meses se expresan como
 * `AAAA-MM-01` en UTC: son meses UTC, independientes de la zona horaria de la sesión.
 */
export interface AuditPartitionAdmin {
  /**
   * Último mes con partición mensual adjunta, o `null` si no hay ninguna. La partición legada (anterior al
   * particionado) no cuenta: su rango no sigue el nombre mensual.
   */
  lastMonthlyPartition(): Promise<string | null>;
  /** Crea la partición del mes (idempotente) con `audit_create_month_partition`; devuelve su nombre. */
  createMonthPartition(month: string): Promise<string>;
}
