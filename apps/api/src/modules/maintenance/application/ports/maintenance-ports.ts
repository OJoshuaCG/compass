import type { OrganizationId } from '../../../../shared/kernel/index.js';

/** Lista las organizaciones para recorrerlas fuera de una petición (ADR 0038). Solo identificadores. */
export interface OrganizationLister {
  listIds(): Promise<OrganizationId[]>;
}

/**
 * Borra un lote de filas vencidas de una tabla efímera. Corre en la transacción en curso, con la
 * organización fijada: RLS limita el borrado a esa organización. Cada módulo implementa el de sus
 * propias tablas.
 */
export interface ExpiredRowsPurger {
  /** Nombre de la tabla, para el informe. */
  readonly table: string;
  /** Borra hasta `limit` filas vencidas antes de `cutoff`; devuelve cuántas borró. */
  purgeBatch(cutoff: Date, limit: number): Promise<number>;
}
