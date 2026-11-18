/**
 * Almacén de clientes OIDC sobre PostgreSQL (`oidc_clients`).
 *
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización, que sale de `app.org_id`,
 *   nunca de un parámetro.
 * - Un `client_id` repetido (único en toda la plataforma) se resuelve con `on conflict do nothing` y devuelve
 *   `null`, sin abortar la transacción.
 * - Nunca se devuelve el secreto cifrado: el listado y los registros públicos no lo incluyen.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type { OidcClientRecord, OidcClientStatus } from '../domain/oidc-client.js';
import { isClientRank } from '../domain/oidc-client.js';
import type { NewOidcClient, OidcClientStore } from '../application/ports/oidc-client-store.js';

interface OidcClientRow {
  readonly id: string;
  readonly client_id: string;
  readonly name: string;
  readonly redirect_uris: string[];
  readonly post_logout_redirect_uris: string[];
  readonly backchannel_logout_uri: string | null;
  readonly allow_private_network_backchannel: boolean;
  readonly allow_refresh_tokens: boolean;
  readonly refresh_justification: string | null;
  readonly is_external: boolean;
  readonly max_rank: number | null;
  readonly status: OidcClientStatus;
  readonly created_at: Date;
}

const CLIENT_COLUMNS = `id, client_id, name, redirect_uris, post_logout_redirect_uris, backchannel_logout_uri,
       allow_private_network_backchannel, allow_refresh_tokens, refresh_justification, is_external, max_rank,
       status, created_at`;

const toRecord = (row: OidcClientRow): OidcClientRecord => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  redirectUris: row.redirect_uris,
  postLogoutRedirectUris: row.post_logout_redirect_uris,
  backchannelLogoutUri: row.backchannel_logout_uri,
  allowPrivateNetworkBackchannel: row.allow_private_network_backchannel,
  allowRefreshTokens: row.allow_refresh_tokens,
  refreshJustification: row.refresh_justification,
  isExternal: row.is_external,
  // La columna tiene un CHECK 0..3; si un dato ajeno lo violara, mejor no entrar a nadie que entrar a todos.
  maxRank: row.max_rank === null ? null : isClientRank(row.max_rank) ? row.max_rank : 0,
  status: row.status,
  createdAt: row.created_at,
});

export class PgOidcClientStore implements OidcClientStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async insert(client: NewOidcClient): Promise<OidcClientRecord | null> {
    const result = await this.transactions.current().query<OidcClientRow>(
      `insert into oidc_clients (
         id, organization_id, client_id, name, secret_ciphertext, redirect_uris, post_logout_redirect_uris,
         backchannel_logout_uri, allow_private_network_backchannel, allow_refresh_tokens, refresh_justification,
         is_external, max_rank, created_by)
       values ($1, nullif(current_setting('app.org_id', true), '')::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13)
       on conflict (client_id) do nothing
       returning ${CLIENT_COLUMNS}`,
      [
        client.id,
        client.clientId,
        client.name,
        Buffer.from(client.secretCiphertext),
        [...client.redirectUris],
        [...client.postLogoutRedirectUris],
        client.backchannelLogoutUri,
        client.allowPrivateNetworkBackchannel,
        client.allowRefreshTokens,
        client.refreshJustification,
        client.isExternal,
        client.maxRank,
        client.createdBy,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async list(): Promise<readonly OidcClientRecord[]> {
    const result = await this.transactions
      .current()
      .query<OidcClientRow>(`select ${CLIENT_COLUMNS} from oidc_clients order by created_at, id`);
    return result.rows.map(toRecord);
  }

  async findForUpdate(id: string): Promise<OidcClientRecord | null> {
    const result = await this.transactions
      .current()
      .query<OidcClientRow>(`select ${CLIENT_COLUMNS} from oidc_clients where id = $1 for update`, [
        id,
      ]);
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  async replaceSecret(id: string, secretCiphertext: Uint8Array): Promise<void> {
    await this.transactions
      .current()
      .query(`update oidc_clients set secret_ciphertext = $2 where id = $1`, [
        id,
        Buffer.from(secretCiphertext),
      ]);
  }

  async disable(id: string, at: Date): Promise<OidcClientRecord> {
    const result = await this.transactions.current().query<OidcClientRow>(
      `update oidc_clients set status = 'disabled', disabled_at = $2
        where id = $1
        returning ${CLIENT_COLUMNS}`,
      [id, at],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('oidc client disappeared between lock and disable');
    }
    return toRecord(row);
  }
}
