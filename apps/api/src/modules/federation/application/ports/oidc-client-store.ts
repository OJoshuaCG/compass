import type { ClientRank, OidcClientRecord } from '../../domain/oidc-client.js';

export interface NewOidcClient {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly secretCiphertext: Uint8Array;
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris: readonly string[];
  readonly backchannelLogoutUri: string | null;
  readonly allowPrivateNetworkBackchannel: boolean;
  readonly allowRefreshTokens: boolean;
  readonly refreshJustification: string | null;
  readonly isExternal: boolean;
  readonly maxRank: ClientRank | null;
  readonly createdBy: string;
}

/** Acceso a `oidc_clients` bajo aislamiento por filas: siempre dentro de la transacción de la organización. */
export interface OidcClientStore {
  insert(client: NewOidcClient): Promise<OidcClientRecord | null>;
  list(): Promise<readonly OidcClientRecord[]>;
  findForUpdate(id: string): Promise<OidcClientRecord | null>;
  replaceSecret(id: string, secretCiphertext: Uint8Array): Promise<void>;
  disable(id: string, at: Date): Promise<OidcClientRecord>;
}

/** Lectura de un cliente por su `client_id` público, dentro de la transacción de su organización (T8). */
export interface OidcClientLookup {
  findActiveByClientId(clientId: string): Promise<OidcClientRecord | null>;
}
