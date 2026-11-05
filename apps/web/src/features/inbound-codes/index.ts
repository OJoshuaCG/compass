/** Fachada pública del feature `inbound-codes`: las vistas de códigos entrantes y, por vista, sus códigos vigentes y su historial (lado lector). */
export { InboundViewsPage } from './containers/inbound-views-page';
export { InboundViewPage } from './containers/inbound-view-page';
/** Configuración de las fuentes de correo (permiso `inbound.configure`). */
export { InboundSourcesPage } from './containers/inbound-sources-page';
/** Configuración de las vistas de las fuentes (permiso `inbound.configure`). */
export { InboundViewSettingsPage } from './containers/inbound-view-settings-page';
/** Con quién se comparte una vista (permiso `share.manage` y MANAGE sobre la vista). */
export { InboundViewSharesPage } from './containers/inbound-view-shares-page';
