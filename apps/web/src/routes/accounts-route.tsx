import { AccountsPage } from '../features/accounts';
import { useMe } from '../shared/auth';

/**
 * Container de ruta de `/accounts`. `GET /accounts` solo exige ser miembro activo (ningún permiso
 * del catálogo), así que basta con tener sesión; las acciones y el inventario se ofrecen dentro de
 * la pantalla según los permisos. El backend decide siempre.
 */
export function AccountsRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return <AccountsPage />;
}
