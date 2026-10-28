/** Fachada pública del feature `security`: la pantalla "Seguridad" (passkeys propias). */
export { SecurityPage } from './containers/security-page';
// Lectura que el Inicio resume; comparte la clave de caché con "Seguridad".
export { fetchMyPasskeys, passkeysKeys } from './api/passkeys-api';
