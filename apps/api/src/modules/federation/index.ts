/** Fachada pública del módulo `federation` (proveedor OIDC, ADR 0050-0052). */
export { ManageOidcClients } from './application/manage-oidc-clients.js';
export type {
  RegisterOidcClientInput,
  RegisteredOidcClient,
} from './application/manage-oidc-clients.js';
export { RevokeGrants } from './application/revoke-grants.js';
export { ReencryptOidcClientSecrets } from './application/reencrypt-oidc-client-secrets.js';
export type { OidcClientSecretStore } from './application/ports/oidc-client-secret-store.js';
export { PgOidcClientSecretStore } from './infrastructure/pg-oidc-client-secret-store.js';
export type { GrantStore } from './application/ports/grant-store.js';
export type { OidcClientStore, NewOidcClient } from './application/ports/oidc-client-store.js';
export type { OidcClientRecord, ClientRank } from './domain/oidc-client.js';
export { PgOidcClientStore } from './infrastructure/pg-oidc-client-store.js';
export { PgGrantStore } from './infrastructure/pg-grant-store.js';
export { AsyncOidcAmbientStore } from './infrastructure/oidc/async-oidc-ambient-store.js';
export { PgOidcOrgResolver } from './infrastructure/oidc/oidc-org-resolver.js';
export { createPgOidcAdapter } from './infrastructure/oidc/pg-oidc-adapter.js';
export { createOidcProvider } from './infrastructure/oidc/create-oidc-provider.js';
export { createInteractionProvider } from './infrastructure/oidc/interaction-provider.js';
export { OidcInteractionHandler } from './interface/oidc-interaction.handler.js';
export type { InteractionPrincipal } from './interface/oidc-interaction.handler.js';
export { SendBackchannelLogout } from './application/send-backchannel-logout.js';
export type { BackchannelLogoutDeliveries } from './application/send-backchannel-logout.js';
export type { LogoutTokenSigner } from './application/ports/logout-token-signer.js';
export { BACKCHANNEL_LOGOUT_EVENT_TYPE } from './domain/backchannel-logout.js';
export { PgBackchannelLogoutQueue } from './infrastructure/pg-backchannel-logout-queue.js';
export { GuardedBackchannelLogoutSender } from './infrastructure/guarded-backchannel-logout-sender.js';
