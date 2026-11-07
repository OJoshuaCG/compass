import { useQuery } from '@tanstack/react-query';

import { accountsKeys, fetchAccountTags } from '../api/accounts-api';

/**
 * Etiquetas en uso para el filtro y las sugerencias. El servidor las filtra por acceso efectivo; la
 * pantalla nunca calcula sugerencias a partir de cuentas ajenas.
 */
export function useAccountTags() {
  return useQuery({
    queryKey: accountsKeys.tags(),
    queryFn: ({ signal }) => fetchAccountTags(signal),
  });
}
