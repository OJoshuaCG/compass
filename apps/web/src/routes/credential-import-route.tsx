import { CredentialImportPage } from '../features/credentials';
import { useMe } from '../shared/auth';

/**
 * Container de ruta de `/credentials/import`. Basta con tener sesión: importar exige
 * `account.create` y `credential.create`, pero eso lo decide el servidor (también al
 * previsualizar) y la pantalla muestra su negativa.
 */
export function CredentialImportRoute() {
  const me = useMe();
  if (me === undefined) return null;
  return <CredentialImportPage />;
}
