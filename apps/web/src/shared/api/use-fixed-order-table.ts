import { DEFAULT_PAGE_LIMIT, type PageLimit } from '@iam/contracts';
import { useState } from 'react';

import { useTableQuery, type FetchPage } from './use-table-query';

/** Paginación que una tabla de orden fijo recibe de su container. */
export type TablePaging = Pick<
  ReturnType<typeof useTableQuery>,
  'limit' | 'onLimitChange' | 'pagination'
>;

export type UseFixedOrderTableOptions<T> = {
  /** Fábrica de claves del feature; nunca cadenas sueltas. */
  queryKey: readonly unknown[];
  fetchPage: FetchPage<T>;
};

/**
 * Listados de orden fijo (sesiones, passkeys, roles, invitaciones): paginan con cursor pero no
 * ordenan ni buscan, así que el único estado es el tamaño de página y vive en memoria, no en la URL.
 * Los datos pueden cambiar desde otro dispositivo, por eso siempre se recargan al volver.
 */
export function useFixedOrderTable<T>({ queryKey, fetchPage }: UseFixedOrderTableOptions<T>) {
  const [limit, setLimit] = useState<PageLimit>(DEFAULT_PAGE_LIMIT);
  return useTableQuery<T>({
    queryKey,
    fetchPage,
    search: { limit },
    onSearchChange: (patch) => {
      if (patch.limit !== undefined) setLimit(patch.limit);
    },
    staleTime: 0,
  });
}
