import { GroupsPage } from '../features/directory';

/**
 * Container de ruta de `/groups`: sin parámetros de búsqueda ni restricción de rango, porque el
 * servidor ya acota la lista a los grupos que la persona puede ver.
 */
export function GroupsRoute() {
  return <GroupsPage />;
}
