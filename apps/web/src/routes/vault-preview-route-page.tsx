import { getRouteApi } from '@tanstack/react-router';

import { VaultPreviewPage } from '../features/vault-preview';

import { vaultPreviewSearchSchema } from './vault-preview-search';

// `getRouteApi` evita importar la definición de la ruta (que carga este archivo de forma
// diferida) y así no hay dependencia circular.
const route = getRouteApi('/_app/vault');

/** Container: conecta los parámetros de búsqueda de la URL con la vista previa de la bóveda. */
export function VaultPreviewRoutePage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <VaultPreviewPage
      search={search}
      onSearchChange={(patch) => {
        void navigate({
          search: (previous) => vaultPreviewSearchSchema.parse({ ...previous, ...patch }),
        });
      }}
    />
  );
}
