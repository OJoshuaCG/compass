import { DEFAULT_PAGE_LIMIT, type AccountListItem, type PageLimit } from '@iam/contracts';
import { useState } from 'react';

import { useTableQuery, type FetchPage } from '../../../shared/api';
import { useDebouncedCommit } from '../../../shared/lib';

export type UseAccountListTableOptions = {
  /** Fábrica de claves del feature; nunca cadenas sueltas. */
  queryKey: readonly unknown[];
  fetchPage: FetchPage<AccountListItem>;
};

/**
 * Listados de cuentas: orden fijo por nombre, con búsqueda de texto, filtro rápido y etiqueta. A
 * diferencia de las tablas de orden fijo sin búsqueda, aquí también viven en memoria `q`, `filter` y `tag` (la pantalla ya
 * mantiene la pestaña en memoria y sus listados no comparten URL). Cambiar la búsqueda o el filtro
 * reinicia la paginación, y la búsqueda se envía solo cuando la persona deja de teclear.
 */
export function useAccountListTable({ queryKey, fetchPage }: UseAccountListTableOptions) {
  const [limit, setLimit] = useState<PageLimit>(DEFAULT_PAGE_LIMIT);
  const [text, setText] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [tag, setTag] = useState<string | undefined>(undefined);

  const table = useTableQuery<AccountListItem>({
    queryKey,
    fetchPage,
    search: { limit, q: text, filter, tag },
    onSearchChange: (patch) => {
      if (patch.limit !== undefined) setLimit(patch.limit);
      if ('q' in patch) setText(patch.q);
      if ('filter' in patch) setFilter(patch.filter);
      if ('tag' in patch) setTag(patch.tag);
    },
    // Los datos pueden cambiar desde otro dispositivo: siempre se recargan al volver.
    staleTime: 0,
  });

  const [draft, setDraft] = useDebouncedCommit(table.q, table.onQueryChange);

  return { ...table, draft, setDraft };
}
