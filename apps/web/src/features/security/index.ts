/** Fachada pública del feature `security`: la pantalla "Seguridad" (passkeys propias). */
export { SecurityPage } from './containers/security-page';
// Lectura que el Inicio resume; comparte la clave de caché con "Seguridad".
export { fetchMyPasskeysPage, passkeysKeys } from './api/passkeys-api';
