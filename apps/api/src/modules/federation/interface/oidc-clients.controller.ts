import { registerOidcClientRequestSchema } from '@iam/contracts';
import type { OidcClient, OidcClientWithSecret, RegisterOidcClientRequest } from '@iam/contracts';
import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { unwrap } from '../../../shared/http/http-decorators.js';
import { ZodValidationPipe } from '../../../shared/http/zod-validation.pipe.js';
import { ManageOidcClients } from '../application/manage-oidc-clients.js';
import type { RegisteredOidcClient } from '../application/manage-oidc-clients.js';
import type { OidcClientRecord } from '../domain/oidc-client.js';

/** El secreto del cliente viaja en el cuerpo: ninguna caché debe guardarlo. */
const NO_STORE = 'no-store';

const uuidPipe = new ZodValidationPipe(z.uuid());

const toClient = (record: OidcClientRecord): OidcClient => ({
  id: record.id,
  clientId: record.clientId,
  name: record.name,
  redirectUris: [...record.redirectUris],
  postLogoutRedirectUris: [...record.postLogoutRedirectUris],
  backchannelLogoutUri: record.backchannelLogoutUri,
  allowPrivateNetworkBackchannel: record.allowPrivateNetworkBackchannel,
  allowRefreshTokens: record.allowRefreshTokens,
  refreshJustification: record.refreshJustification,
  isExternal: record.isExternal,
  maxRank: record.maxRank,
  status: record.status,
  createdAt: record.createdAt.toISOString(),
});

const toClientWithSecret = (registered: RegisteredOidcClient): OidcClientWithSecret => ({
  client: toClient(registered.client),
  clientSecret: registered.clientSecret,
});

/**
 * Registro de aplicaciones cliente OIDC. Ninguna ruta es idempotente (el secreto se muestra una sola vez,
 * así que reintentar una creación no puede devolver el mismo cuerpo) y cada una se autoriza en el caso de uso.
 */
@Controller('sso/clients')
export class OidcClientsController {
  constructor(private readonly manageOidcClients: ManageOidcClients) {}

  @Get()
  async list(): Promise<{ data: OidcClient[] }> {
    const records = unwrap(await this.manageOidcClients.list());
    return { data: records.map(toClient) };
  }

  @Post()
  @Header('Cache-Control', NO_STORE)
  async register(
    @Body(new ZodValidationPipe(registerOidcClientRequestSchema)) body: RegisterOidcClientRequest,
  ): Promise<{ data: OidcClientWithSecret }> {
    const registered = unwrap(await this.manageOidcClients.register(body));
    return { data: toClientWithSecret(registered) };
  }

  @Post(':id/rotate-secret')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  async rotateSecret(@Param('id', uuidPipe) id: string): Promise<{ data: OidcClientWithSecret }> {
    const registered = unwrap(await this.manageOidcClients.rotateSecret(id));
    return { data: toClientWithSecret(registered) };
  }

  @Post(':id/disable')
  @HttpCode(200)
  async disable(@Param('id', uuidPipe) id: string): Promise<{ data: OidcClient }> {
    const record = unwrap(await this.manageOidcClients.disable(id));
    return { data: toClient(record) };
  }
}
