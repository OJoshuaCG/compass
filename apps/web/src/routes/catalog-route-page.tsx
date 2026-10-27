import { getRouteApi } from '@tanstack/react-router';

import { CatalogPage } from '../features/catalog';

import { catalogSearchSchema } from './catalog-search';

// `getRouteApi` evita importar la definición de la ruta (que carga este archivo de forma
// diferida) y así no hay dependencia circular.
const route = getRouteApi('/_app/catalog');

/** Container: conecta los parámetros de búsqueda de la URL con el feature (presentacional). */
export function CatalogRoutePage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <CatalogPage
      search={search}
      onSearchChange={(patch) => {
        void navigate({
          search: (previous) => catalogSearchSchema.parse({ ...previous, ...patch }),
        });
      }}
    />
  );
}
