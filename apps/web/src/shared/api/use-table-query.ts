import { pageSchema, type PageLimit } from '@iam/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';

import type { ApiClient } from './client';

export type SortDirection = 'asc' | 'desc';

/** Estado de la tabla que vive en la URL (docs/frontend.md §6.2). El cursor NO va aquí. */
export type TableSearch = {
  sort?: string | undefined;
  dir?: SortDirection | undefined;
  limit: PageLimit;
  q?: string | undefined;
};

export type PageParams = Pick<TableSearch, 'sort' | 'dir' | 'limit' | 'q'> & {
  cursor?: string | undefined;
};

export type Page<T> = {
  data: T[];
  page: { nextCursor: string | null; limit: number; total?: number | undefined };
};

export type FetchPage<T> = (params: PageParams, signal: AbortSignal) => Promise<Page<T>>;

/** Fábrica de `fetchPage` para un listado de la API (`?cursor=&limit=&sort=&dir=&q=`). */
export function createListFetcher<S extends z.ZodType>(
  client: ApiClient,
  path: string,
  item: S,
): FetchPage<z.infer<S>> {
  const schema = pageSchema(item);
  return async (params, signal) => {
    return client.get(path, schema, {
      signal,
      query: {
        cursor: params.cursor,
        limit: params.limit,
        sort: params.sort,
        dir: params.dir,
        q: params.q,
      },
    });
  };
}

export type UseTableQueryOptions<T> = {
  /** Fábrica de claves del feature, p. ej. `vaultKeys.list`; nunca cadenas sueltas. */
  queryKey: readonly unknown[];
  fetchPage: FetchPage<T>;
  search: TableSearch;
  /** El container traduce esto a una navegación del router (parámetros de búsqueda). */
  onSearchChange: (patch: Partial<TableSearch>) => void;
  staleTime?: number;
};

/**
 * Une la URL, la pila de cursores y TanStack Query (docs/frontend.md §6.3).
 * - El cursor es opaco y caduca: vive solo en memoria, como pila para poder retroceder.
 * - Cambiar orden, límite o búsqueda reinicia la pila (vuelve a la primera página).
 * - `keepPreviousData` evita el parpadeo al cambiar de página.
 */
export function useTableQuery<T>({
  queryKey,
  fetchPage,
  search,
  onSearchChange,
  staleTime = 30_000,
}: UseTableQueryOptions<T>) {
  // La pila va ligada a la firma de la vista: si cambia la firma, la pila anterior se ignora
  // sin necesidad de efectos ni de sincronizar estado.
  const signature = JSON.stringify([search.sort, search.dir, search.limit, search.q]);
  const [stack, setStack] = useState<{ signature: string; cursors: string[] }>({
    signature,
    cursors: [],
  });
  const cursors = stack.signature === signature ? stack.cursors : [];
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [...queryKey, { ...search, cursor }],
    queryFn: ({ signal }) => fetchPage({ ...search, cursor }, signal),
    placeholderData: keepPreviousData,
    staleTime,
  });

  const nextCursor = query.data?.page.nextCursor ?? null;
  const sort =
    search.sort !== undefined && search.dir !== undefined
      ? { key: search.sort, dir: search.dir }
      : undefined;
  const hasActiveFilters = search.q !== undefined && search.q !== '';

  return {
    rows: query.data?.data ?? [],
    status: query.isError
      ? ('error' as const)
      : query.data === undefined
        ? ('loading' as const)
        : ('success' as const),
    error: query.error,
    refreshing: query.isFetching && query.data !== undefined,
    retry: () => {
      void query.refetch();
    },
    sort,
    onSortChange: (next?: { key: string; dir: SortDirection }) => {
      onSearchChange({ sort: next?.key, dir: next?.dir });
    },
    limit: search.limit,
    onLimitChange: (limit: PageLimit) => {
      onSearchChange({ limit });
    },
    pagination: {
      hasPrevious: cursors.length > 0,
      hasNext: nextCursor !== null,
      onPrevious: () => {
        setStack({ signature, cursors: cursors.slice(0, -1) });
      },
      onNext: () => {
        if (nextCursor !== null) setStack({ signature, cursors: [...cursors, nextCursor] });
      },
      total: query.data?.page.total,
      offset: cursors.length * search.limit,
    },
    q: search.q ?? '',
    onQueryChange: (q: string) => {
      onSearchChange({ q: q === '' ? undefined : q });
    },
    hasActiveFilters,
    clearFilters: () => {
      onSearchChange({ q: undefined });
    },
  };
}
