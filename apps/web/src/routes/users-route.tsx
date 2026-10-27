import { getRouteApi } from '@tanstack/react-router';

import { UsersPage } from '../features/directory';

import { usersSearchSchema } from './search-schemas';

const route = getRouteApi('/_app/users');

/** Container de ruta de `/users`: conecta los parámetros de búsqueda de la URL con el feature. */
export function UsersRoute() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <UsersPage
      search={search}
      onSearchChange={(patch) => {
        void navigate({
          search: (previous) => usersSearchSchema.parse({ ...previous, ...patch }),
        });
      }}
    />
  );
}
