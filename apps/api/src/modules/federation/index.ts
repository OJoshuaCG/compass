/** Fachada pública del módulo `federation` (proveedor OIDC, ADR 0050-0052). */
export { ManageOidcClients } from './application/manage-oidc-clients.js';
export type {
  RegisterOidcClientInput,
  RegisteredOidcClient,
} from './application/manage-oidc-clients.js';
export { RevokeGrants } from './application/revoke-grants.js';
export type { GrantStore } from './application/ports/grant-store.js';
export type { OidcClientStore, NewOidcClient } from './application/ports/oidc-client-store.js';
export type { OidcClientRecord, ClientRank } from './domain/oidc-client.js';
export { PgOidcClientStore } from './infrastructure/pg-oidc-client-store.js';
export { PgGrantStore } from './infrastructure/pg-grant-store.js';
