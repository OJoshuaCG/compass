/**
 * Fábrica del proveedor OIDC (`oidc-provider` 9.13.3). Solo construye y configura: el montaje sobre Fastify
 * y las rutas de interacción son de T7 y T8.
 *
 * Invariantes de seguridad (ADR 0050, 0051 y 0052)
 * - Solo flujo de código con PKCE `S256` obligatorio para todo cliente. Sin implicit, sin password, sin
 *   registro dinámico, sin dispositivo: ninguna de esas funciones se habilita y los clientes solo declaran
 *   `authorization_code` (y `refresh_token` si el registro lo justificó).
 * - Claves de firma propias (`jwks`), nunca las de desarrollo del paquete. Un refresh token se rota en cada
 *   uso y su reuso revoca la concesión (comportamiento del paquete con `rotateRefreshToken`).
 * - Vidas cortas: access token 5 minutos, código 60 s, id token 5 minutos. El adaptador recorta además todo al
 *   vencimiento de la sesión de Compass.
 * - Ninguna función experimental está activa, así que no hay `ack` que fijar; si se habilitara una, el
 *   paquete obliga a declararlo y una actualización incompatible falla al arrancar (S7).
 */
import Provider from 'oidc-provider';
import type { AdapterConstructor } from 'oidc-provider';

export const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
export const ID_TOKEN_TTL_SECONDS = 5 * 60;
export const INTERACTION_TTL_SECONDS = 10 * 60;
/** Tope absoluto de la sesión de Compass (ADR 0051 §4): ninguna concesión vive más, y el adaptador la recorta. */
export const MAX_GRANT_TTL_SECONDS = 12 * 60 * 60;

/** Metadatos propios que `oidc-provider` conserva en el cliente para la interacción de login. */
export const COMPASS_CLIENT_METADATA: readonly string[] = [
  'compass_is_external',
  'compass_max_rank',
  'compass_allow_private_network_backchannel',
];

export interface OidcAccountClaims {
  readonly name: string;
  readonly email: string;
}

export interface CreateOidcProviderOptions {
  /** `APP_ORIGIN`: el emisor único de la plataforma. */
  readonly issuer: string;
  readonly adapter: AdapterConstructor;
  /** JWK privadas activas (`SigningKeyService.loadKeySet().privateJwks`); la primera firma. */
  readonly privateJwks: readonly Readonly<Record<string, unknown>>[];
  /** Claves para firmar las cookies del paquete; la primera firma, las demás solo verifican (rotación). */
  readonly cookieKeys: readonly string[];
  /** Algoritmo con el que se firman los id token; debe coincidir con el de las claves activas. */
  readonly idTokenSigningAlg: 'ES256' | 'RS256';
  /** Dirección de la pantalla de interacción servida por Compass (T8). */
  readonly interactionUrl: (uid: string) => string;
  /** Datos del perfil de una persona activa; `null` si ya no existe o no está activa. */
  readonly loadAccountClaims: (accountId: string) => Promise<OidcAccountClaims | null>;
}

export function createOidcProvider(options: CreateOidcProviderOptions): Provider {
  const provider = new Provider(options.issuer, {
    adapter: options.adapter,
    jwks: { keys: options.privateJwks },
    cookies: { keys: [...options.cookieKeys] },
    clientDefaults: { id_token_signed_response_alg: options.idTokenSigningAlg },
    enabledJWA: { idTokenSigningAlgValues: [options.idTokenSigningAlg] },
    // Solo código: sin implícito ni híbrido, ni siquiera para un cliente mal registrado.
    responseTypes: ['code'],
    pkce: { required: () => true },
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    claims: {
      openid: ['sub', 'sid'],
      profile: ['name'],
      email: ['email', 'email_verified'],
    },
    ttl: {
      AccessToken: ACCESS_TOKEN_TTL_SECONDS,
      AuthorizationCode: AUTHORIZATION_CODE_TTL_SECONDS,
      IdToken: ID_TOKEN_TTL_SECONDS,
      Interaction: INTERACTION_TTL_SECONDS,
      Grant: MAX_GRANT_TTL_SECONDS,
      Session: MAX_GRANT_TTL_SECONDS,
      RefreshToken: MAX_GRANT_TTL_SECONDS,
    },
    rotateRefreshToken: true,
    // Todo bajo `/oidc`: así no choca con las rutas de la SPA (`/auth`, `/me`...) y el montaje en Fastify
    // solo necesita un prefijo más el documento de descubrimiento, que la especificación fija.
    routes: {
      authorization: '/oidc/auth',
      backchannel_authentication: '/oidc/backchannel',
      code_verification: '/oidc/device',
      device_authorization: '/oidc/device/auth',
      end_session: '/oidc/session/end',
      introspection: '/oidc/token/introspection',
      jwks: '/oidc/jwks',
      pushed_authorization_request: '/oidc/request',
      registration: '/oidc/reg',
      revocation: '/oidc/token/revocation',
      token: '/oidc/token',
      userinfo: '/oidc/me',
    },
    extraClientMetadata: { properties: [...COMPASS_CLIENT_METADATA] },
    interactions: {
      url: (_ctx: unknown, interaction: { uid: string }) => options.interactionUrl(interaction.uid),
    },
    findAccount: (_ctx: unknown, accountId: string) =>
      Promise.resolve({
        accountId,
        claims: async (): Promise<Record<string, unknown>> => {
          const profile = await options.loadAccountClaims(accountId);
          if (profile === null) return { sub: accountId };
          // Compass no verifica el correo por esta vía: la persona entró con él, pero la bandera solo se
          // declara verdadera cuando exista una verificación propia.
          return {
            sub: accountId,
            name: profile.name,
            email: profile.email,
            email_verified: false,
          };
        },
      }),
    features: {
      devInteractions: { enabled: false },
      backchannelLogout: { enabled: true },
      rpInitiatedLogout: { enabled: true },
      revocation: { enabled: true },
    },
  });
  provider.proxy = true;
  return provider;
}
