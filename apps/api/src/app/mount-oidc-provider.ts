/**
 * Monta el proveedor OIDC (`oidc-provider`, una aplicación Koa) sobre Fastify sin agregar dependencias
 * (ADR 0050, spike 6): la ruta entrega la petición cruda al `callback()` del paquete.
 *
 * Invariantes de seguridad
 * - Solo se exponen `OIDC_ROUTE_PREFIX/*` y el documento de descubrimiento; el comodín de la SPA
 *   (`serve-web.ts`) nunca llega a ver estas rutas y estas rutas nunca caen en `/api/v1`.
 * - El paquete lee el cuerpo por sí mismo: dentro de este alcance se quitan los analizadores de Fastify
 *   para no consumir el flujo antes de tiempo. El resto de la API conserva los suyos (alcance encapsulado).
 * - Al entregar la respuesta al paquete, Fastify ya no la procesa (`hijack`): las cabeceras de seguridad
 *   (helmet) y las del proyecto se copian a mano antes de llamarlo.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Todas las rutas del paquete viven bajo este prefijo (ver `routes` en `create-oidc-provider.ts`). */
export const OIDC_ROUTE_PREFIX = '/oidc';

/** Ruta fija por especificación (RFC 8414 / OIDC Discovery): no admite prefijo. */
export const OIDC_DISCOVERY_PATH = '/.well-known/openid-configuration';

export interface OidcCallbackProvider {
  callback(): (request: IncomingMessage, response: ServerResponse) => void;
}

/** Manejador de las interacciones de login y consentimiento (`/oidc/interaction/:uid`). */
export interface OidcInteractionRoute {
  /** Entrega la petición al proveedor bajo el contexto de la sesión de Compass, si la cookie es válida. */
  runUnderCompassSession(
    sessionToken: string | undefined,
    requestId: string,
    work: () => void,
  ): Promise<void>;
  handle(input: InteractionRouteInput): Promise<void>;
  /** Pantalla de consentimiento de un cliente externo: describe lo pedido o registra la decisión. */
  handleConsent(input: InteractionRouteInput, action: 'describe' | 'allow' | 'deny'): Promise<void>;
}

interface InteractionRouteInput {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly uid: string;
  readonly sessionToken: string | undefined;
  readonly requestId: string;
}

export interface MountOidcProviderOptions {
  readonly provider: OidcCallbackProvider;
  readonly interaction?: OidcInteractionRoute;
  /** Cookie de sesión de Compass, que solo la ruta de interacción lee (la del proveedor no basta, L8). */
  readonly sessionCookieName?: string;
  /** Origen del navegador: las decisiones de consentimiento (POST) solo se aceptan desde él. */
  readonly appOrigin?: string;
  /** Cabeceras propias del proyecto que el `onSend` de Fastify no aplicará a una respuesta entregada. */
  readonly staticHeaders: Readonly<Record<string, string>>;
}

export async function mountOidcProvider(
  app: NestFastifyApplication,
  options: MountOidcProviderOptions,
): Promise<void> {
  const handle = options.provider.callback();

  await app.register((scope, _opts, done) => {
    scope.removeAllContentTypeParsers();
    // El paquete analiza el cuerpo (formularios y JSON) con sus propios límites.
    scope.addContentTypeParser('*', (_request, _payload, parsed) => {
      parsed(null);
    });

    // Fastify ya no procesa una respuesta entregada: las cabeceras de seguridad se copian antes.
    const prepare = (request: FastifyRequest, reply: FastifyReply): void => {
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      for (const [name, value] of Object.entries(options.staticHeaders)) {
        reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader('x-request-id', request.id);
      reply.hijack();
    };

    const deliver = (request: FastifyRequest, reply: FastifyReply): void => {
      prepare(request, reply);
      handle(request.raw, reply.raw);
    };

    const { interaction, sessionCookieName } = options;
    if (interaction !== undefined && sessionCookieName !== undefined) {
      // Más específica que el comodín: Fastify la elige primero. Solo GET; el resto cae en el paquete.
      scope.get<{ Params: { uid: string } }>(
        `${OIDC_ROUTE_PREFIX}/interaction/:uid`,
        (request, reply) => {
          prepare(request, reply);
          void interaction.handle({
            request: request.raw,
            response: reply.raw,
            uid: request.params.uid,
            sessionToken: request.cookies[sessionCookieName],
            requestId: request.id,
          });
        },
      );
    }

    if (interaction !== undefined && sessionCookieName !== undefined) {
      const consentInput = (
        request: FastifyRequest<{ Params: { uid: string } }>,
        reply: FastifyReply,
      ): InteractionRouteInput => ({
        request: request.raw,
        response: reply.raw,
        uid: request.params.uid,
        sessionToken: request.cookies[sessionCookieName],
        requestId: request.id,
      });
      // Detalle para la pantalla de consentimiento: la cookie `_interaction` solo viaja bajo esta ruta.
      scope.get<{ Params: { uid: string } }>(
        `${OIDC_ROUTE_PREFIX}/interaction/:uid/consent`,
        (request, reply) => {
          prepare(request, reply);
          void interaction.handleConsent(consentInput(request, reply), 'describe');
        },
      );
      for (const decision of ['allow', 'deny'] as const) {
        scope.post<{ Params: { uid: string } }>(
          `${OIDC_ROUTE_PREFIX}/interaction/:uid/consent/${decision}`,
          (request, reply) => {
            prepare(request, reply);
            // Defensa en profundidad contra CSRF además de SameSite=Lax: el origen debe ser el de la SPA.
            if (options.appOrigin === undefined || request.headers.origin !== options.appOrigin) {
              reply.raw.statusCode = 403;
              reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
              reply.raw.end('Forbidden');
              return;
            }
            void interaction.handleConsent(consentInput(request, reply), decision);
          },
        );
      }
    }

    if (interaction !== undefined && sessionCookieName !== undefined) {
      // Reanudar la autorización (`/oidc/auth/:uid`) guarda la sesión del proveedor, que debe quedar ligada a la
      // sesión de Compass de quien navega (L8): el navegador envía la cookie en esta navegación de primer nivel.
      scope.all(`${OIDC_ROUTE_PREFIX}/auth/*`, (request, reply) => {
        prepare(request, reply);
        interaction
          .runUnderCompassSession(request.cookies[sessionCookieName], request.id, () => {
            handle(request.raw, reply.raw);
          })
          .catch(() => {
            // Sin este manejo, un fallo aquí sería un rechazo sin atender que puede tumbar el proceso.
            // La respuesta es genérica: nada del error llega al navegador.
            if (!reply.raw.headersSent) {
              reply.raw.statusCode = 500;
              reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }
            reply.raw.end('Internal Server Error');
          });
      });
    }

    scope.all(`${OIDC_ROUTE_PREFIX}/*`, deliver);
    scope.all(OIDC_DISCOVERY_PATH, deliver);
    done();
  });
}
