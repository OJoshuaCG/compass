/**
 * Purga de datos efímeros vencidos (ADR 0038).
 *
 * Invariantes de seguridad
 * - Nunca borra fuera de una organización: cada lote corre con `app.org_id` fijado y RLS limita
 *   el borrado a esa organización. Sin contexto, la base de datos no borra nada (falla cerrada).
 * - Solo borra filas vencidas hace más de `PURGE_GRACE_MS`: una petición en curso nunca pierde su
 *   fila, y la aplicación ya trata una fila vencida como inexistente.
 * - Lotes cortos, cada uno en su propia transacción, para no retener bloqueos.
 * - No audita: purgar datos efímeros vencidos no es una acción de negocio ni toca datos personales.
 */
import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { ExpiredRowsPurger, OrganizationLister } from './ports/maintenance-ports.js';

export const PURGE_GRACE_MS = 60 * 60 * 1000;
export const PURGE_BATCH_SIZE = 1000;

export interface PurgeReport {
  readonly organizations: number;
  /** Filas borradas por tabla, sumando todas las organizaciones. */
  readonly deleted: Readonly<Record<string, number>>;
}

export class PurgeExpiredRows {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationLister;
      readonly scope: TenantScope;
      readonly purgers: readonly ExpiredRowsPurger[];
      readonly clock: Clock;
      readonly ids: IdGenerator;
    },
  ) {}

  async execute(): Promise<PurgeReport> {
    const { organizations, purgers, clock } = this.deps;
    const cutoff = new Date(clock.now().getTime() - PURGE_GRACE_MS);
    const deleted: Record<string, number> = Object.fromEntries(
      purgers.map((purger) => [purger.table, 0]),
    );
    const organizationIds = await organizations.listIds();
    for (const organizationId of organizationIds) {
      for (const purger of purgers) {
        deleted[purger.table] =
          (deleted[purger.table] ?? 0) + (await this.purgeAll(organizationId, purger, cutoff));
      }
    }
    return { organizations: organizationIds.length, deleted };
  }

  /** Lote tras lote hasta que uno sale incompleto: ya no quedan filas vencidas en esa organización. */
  private async purgeAll(
    organizationId: OrganizationId,
    purger: ExpiredRowsPurger,
    cutoff: Date,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const removed = await this.deps.scope.runAs(
        { organizationId, actorId: null, requestId: `purge-${this.deps.ids.next()}` },
        () => purger.purgeBatch(cutoff, PURGE_BATCH_SIZE),
      );
      total += removed;
      if (removed < PURGE_BATCH_SIZE) return total;
    }
  }
}
