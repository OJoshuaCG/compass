import { z } from 'zod';

/** Rango máximo que puede entrar por un cliente: 0 Raíz … 3 Operador. Nulo: cualquier persona activa de la organización. */
export const OIDC_CLIENT_MAX_RANKS = [0, 1, 2, 3] as const;

/** Registro de una aplicación cliente OIDC (ADR 0052). La validación fina de las direcciones vive en el dominio. */
export const registerOidcClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  redirectUris: z.array(z.string().max(2048)).min(1).max(10),
  postLogoutRedirectUris: z.array(z.string().max(2048)).max(10).optional(),
  backchannelLogoutUri: z.string().max(2048).nullish(),
  allowPrivateNetworkBackchannel: z.boolean().optional(),
  refreshJustification: z.string().max(500).nullish(),
  isExternal: z.boolean().optional(),
  maxRank: z.number().int().min(0).max(3).nullish(),
});
export type RegisterOidcClientRequest = z.infer<typeof registerOidcClientRequestSchema>;

export const oidcClientSchema = z.object({
  id: z.uuid(),
  clientId: z.string(),
  name: z.string(),
  redirectUris: z.array(z.string()),
  postLogoutRedirectUris: z.array(z.string()),
  backchannelLogoutUri: z.string().nullable(),
  allowPrivateNetworkBackchannel: z.boolean(),
  allowRefreshTokens: z.boolean(),
  refreshJustification: z.string().nullable(),
  isExternal: z.boolean(),
  maxRank: z.number().int().min(0).max(3).nullable(),
  status: z.enum(['active', 'disabled']),
  createdAt: z.iso.datetime(),
});
export type OidcClient = z.infer<typeof oidcClientSchema>;

/** Respuesta al crear o rotar: el secreto se muestra esta única vez y no vuelve a poder consultarse. */
export const oidcClientWithSecretSchema = z.object({
  client: oidcClientSchema,
  clientSecret: z.string(),
});
export type OidcClientWithSecret = z.infer<typeof oidcClientWithSecretSchema>;
