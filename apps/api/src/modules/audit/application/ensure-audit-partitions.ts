/**
 * Invariantes de seguridad
 * - Solo crea particiones vacías con `audit_create_month_partition`; no toca filas de auditoría ni retira
 *   particiones (el retiro queda fuera de este trabajo, ADR 0024).
 * - La función de base de datos pertenece al rol de migraciones: este trabajo corre con ese rol, nunca con `iam_app`.
 * - Es idempotente: repetirlo no duplica ni falla si el mes ya está cubierto.
 * - Informa el margen ANTES de crear: si ya quedaban menos de `AUDIT_PARTITION_MIN_RUNWAY_MONTHS`, el trabajo
 *   programado se había atrasado y alguien debe enterarse, aunque ahora se haya repuesto el margen.
 */
import type { Clock } from '../../../shared/kernel/index.js';
import type { AuditPartitionAdmin } from './ports/audit-partition-ports.js';

/** Meses de partición por delante que el trabajo deja creados; coincide con los 24 que crea la migración 0046. */
export const AUDIT_PARTITION_TARGET_AHEAD_MONTHS = 24;

/**
 * Margen mínimo antes de avisar: con menos de 6 meses por delante hay poco tiempo para reaccionar. Si falta la
 * partición del mes, el insert de auditoría falla cerrado y se pierde la acción auditada.
 */
export const AUDIT_PARTITION_MIN_RUNWAY_MONTHS = 6;

export interface PartitionSummary {
  /** Meses (`AAAA-MM-01`) que este trabajo creó ahora. */
  readonly createdMonths: readonly string[];
  /** Meses completos con partición por delante del mes en curso, antes de crear. */
  readonly runwayBeforeMonths: number;
  readonly runwayAfterMonths: number;
  /** `true` si el margen previo ya estaba por debajo del mínimo (el trabajo programado se atrasó). */
  readonly lowRunway: boolean;
  /** Nombre del error y su código, si crear un mes falló; nunca el mensaje. */
  readonly failure: string | null;
}

export class EnsureAuditPartitions {
  constructor(
    private readonly deps: { readonly admin: AuditPartitionAdmin; readonly clock: Clock },
  ) {}

  async execute(): Promise<PartitionSummary> {
    const now = this.deps.clock.now();
    const currentIndex = monthIndex(now.getUTCFullYear(), now.getUTCMonth());
    const last = await this.deps.admin.lastMonthlyPartition();
    // Sin particiones mensuales se parte del mes en curso: la legada lo cubre y no se intenta crearlo.
    const lastIndex = last === null ? currentIndex : parseMonthIndex(last);
    const runwayBeforeMonths = Math.max(0, lastIndex - currentIndex);

    const createdMonths: string[] = [];
    let failure: string | null = null;
    let coveredIndex = Math.max(lastIndex, currentIndex);
    const targetIndex = currentIndex + AUDIT_PARTITION_TARGET_AHEAD_MONTHS;

    for (let index = coveredIndex + 1; index <= targetIndex; index += 1) {
      const month = formatMonth(index);
      try {
        await this.deps.admin.createMonthPartition(month);
      } catch (error) {
        failure = describeFailure(error);
        break;
      }
      createdMonths.push(month);
      coveredIndex = index;
    }

    return {
      createdMonths,
      runwayBeforeMonths,
      runwayAfterMonths: coveredIndex - currentIndex,
      lowRunway: runwayBeforeMonths < AUDIT_PARTITION_MIN_RUNWAY_MONTHS,
      failure,
    };
  }
}

const MONTHS_PER_YEAR = 12;

function monthIndex(year: number, zeroBasedMonth: number): number {
  return year * MONTHS_PER_YEAR + zeroBasedMonth;
}

function parseMonthIndex(month: string): number {
  const match = /^(\d{4})-(\d{2})-01$/.exec(month);
  if (match === null) throw new Error(`Invalid month: ${month}`);
  return monthIndex(Number(match[1]), Number(match[2]) - 1);
}

function formatMonth(index: number): string {
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = (index % MONTHS_PER_YEAR) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
