export type SummaryCount =
  | { kind: 'exact'; value: number }
  /** Hay más filas de las que trajo la página y el servidor no informa el total. */
  | { kind: 'unavailable' };

/** Lo mínimo que se lee de un listado paginado; coincide con `Page<T>` de la capa compartida. */
export type CountablePage = {
  data: readonly unknown[];
  page: { nextCursor: string | null; total?: number | undefined };
};

/**
 * Cifra de un listado, solo si es exacta. Por orden de confianza:
 * 1. el `total` del servidor, si algún día lo envía (hoy ningún listado lo hace);
 * 2. la longitud de la página, cuando no hay página siguiente (`nextCursor` nulo): es la lista completa;
 * 3. nada: con página siguiente la cifra sería un mínimo, y una aproximación en una tarjeta se
 *    leería como dato real.
 */
export function summaryCountOf(page: CountablePage): SummaryCount {
  if (page.page.total !== undefined) return { kind: 'exact', value: page.page.total };
  if (page.page.nextCursor === null) return { kind: 'exact', value: page.data.length };
  return { kind: 'unavailable' };
}
