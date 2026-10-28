/** Fachada pública del feature `sessions`: la pantalla "Mis sesiones". */
export { SessionsPage } from './containers/sessions-page';
// Lectura que el Inicio resume; comparte la clave de caché con "Mis sesiones".
export { fetchMySessions, sessionsKeys } from './api/sessions-api';
