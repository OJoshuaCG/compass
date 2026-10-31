import { DEFAULT_PAGE_LIMIT, type PageLimit } from '@iam/contracts';
import { useState } from 'react';

export type ClientPagination<T> = {
  /** Filas de la página actual. */
  pageRows: T[];
  limit: PageLimit;
  onLimitChange: (limit: PageLimit) => void;
  /** Listo para pasarse a la prop `pagination` de `DataTable`. */
  pagination: {
    hasPrevious: boolean;
    hasNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    total: number;
    offset: number;
  };
};

/**
 * Pagina en memoria un listado que el servidor devuelve completo (sin cursor). El pie de la tabla
 * estándar se muestra siempre, porque esos listados pueden crecer. Si la lista se acorta (por
 * ejemplo al revocar un acceso) la página se ajusta a la última que exista, para no quedar
 * en una página vacía.
 */
export function useClientPagination<T>(rows: readonly T[]): ClientPagination<T> {
  const [requestedOffset, setRequestedOffset] = useState(0);
  const [limit, setLimit] = useState<PageLimit>(DEFAULT_PAGE_LIMIT);

  const lastPageOffset = rows.length === 0 ? 0 : Math.floor((rows.length - 1) / limit) * limit;
  const offset = Math.min(requestedOffset, lastPageOffset);

  return {
    pageRows: rows.slice(offset, offset + limit),
    limit,
    onLimitChange: (next) => {
      setLimit(next);
      setRequestedOffset(0);
    },
    pagination: {
      hasPrevious: offset > 0,
      hasNext: offset + limit < rows.length,
      onPrevious: () => {
        setRequestedOffset(Math.max(0, offset - limit));
      },
      onNext: () => {
        setRequestedOffset(offset + limit);
      },
      total: rows.length,
      offset,
    },
  };
}
