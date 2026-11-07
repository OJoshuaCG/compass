import { useQuery } from '@tanstack/react-query';

import { accountsKeys, fetchAccountTags, type AccountTagsScope } from '../api/accounts-api';

/**
 * Etiquetas en uso para el filtro y las sugerencias. Las de `mine` las filtra el servidor por acceso
 * efectivo; la pantalla nunca calcula sugerencias a partir de cuentas ajenas.
 */
export function useAccountTags(scope: AccountTagsScope, enabled = true) {
  return useQuery({
    queryKey: accountsKeys.tags(scope),
    queryFn: ({ signal }) => fetchAccountTags(scope, signal),
    enabled,
  });
}
