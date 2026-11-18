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

export interface MountOidcProviderOptions {
  readonly provider: OidcCallbackProvider;
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

    const deliver = (request: FastifyRequest, reply: FastifyReply): void => {
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) reply.raw.setHeader(name, value);
      }
      for (const [name, value] of Object.entries(options.staticHeaders)) {
        reply.raw.setHeader(name, value);
      }
      reply.raw.setHeader('x-request-id', request.id);
      reply.hijack();
      handle(request.raw, reply.raw);
    };

    scope.all(`${OIDC_ROUTE_PREFIX}/*`, deliver);
    scope.all(OIDC_DISCOVERY_PATH, deliver);
    done();
  });
}
