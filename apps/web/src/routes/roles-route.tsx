import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

import { RoleEditorPage, RolesPage } from '../features/roles';
import { useMe } from '../shared/auth';

import { NotFoundPage } from './not-found-page';

const newRoleRoute = getRouteApi('/_app/roles/new');
const roleRoute = getRouteApi('/_app/roles/$roleId');

/** Sin `role.manage` las pantallas de roles responden como inexistentes; el backend decide igual. */
function useCanManageRoles(): boolean | undefined {
  const me = useMe();
  return me === undefined ? undefined : me.permissions.includes('role.manage');
}

/**
 * Container de ruta de `/roles`. Sin `role.manage` responde como una ruta inexistente (no revela
 * la pantalla); es solo comodidad, porque el backend decide siempre.
 */
export function RolesRoute() {
  const canManage = useCanManageRoles();
  if (canManage === undefined) return null;
  return canManage ? <RolesPage /> : <NotFoundPage />;
}

/** Container de ruta de `/roles/new` (con `?from=` al duplicar un rol). */
export function NewRoleRoute() {
  const canManage = useCanManageRoles();
  const { from } = newRoleRoute.useSearch();
  if (canManage === undefined) return null;
  return canManage ? <RoleEditorPage fromId={from} /> : <NotFoundPage />;
}

/** Container de ruta de `/roles/:roleId`. Un id que no es UUID responde 404 sin llamar a la API. */
export function RoleRoute() {
  const canManage = useCanManageRoles();
  const { roleId } = roleRoute.useParams();
  if (canManage === undefined) return null;
  if (!canManage || !z.uuid().safeParse(roleId).success) return <NotFoundPage />;
  return <RoleEditorPage roleId={roleId} />;
}
