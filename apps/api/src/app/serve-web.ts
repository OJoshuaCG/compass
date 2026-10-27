/**
 * Servir la SPA desde el mismo origen que la API (plan: "Frontend"): así la cookie de sesión es de
 * primera parte, no hay CORS abierto y la CSP estricta de la API cubre también las páginas.
 *
 * Invariantes de seguridad
 * - Solo se sirven archivos dentro de `root` (lo garantiza `@fastify/static`); un intento de
 *   salirse con `..` no devuelve nada fuera de la carpeta.
 * - Una ruta `/api/...` desconocida responde 404 en formato Problem Details, nunca el HTML de la SPA.
 * - Las rutas del cliente (`/login`, `/users`...) devuelven `index.html` y la app decide qué mostrar.
 */
import { ErrorCode } from '@iam/contracts';
import { relative } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function serveWebApp(app: NestFastifyApplication, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    // Sin comodín propio: se registran los archivos existentes y el fallback lo define esta función.
    wildcard: false,
    setHeaders(response, path) {
      // Los archivos con hash en el nombre (`/assets/`) nunca cambian; el HTML siempre se revalida
      // para que un despliegue nuevo se vea de inmediato.
      // Se decide por la ruta RELATIVA a la carpeta web: una carpeta de despliegue que se llame
      // `assets` en cualquier ancestro no debe volver inmutable el `index.html`.
      const relativePath = relative(root, path).split('\\').join('/');
      response.header(
        'cache-control',
        relativePath.startsWith('assets/')
          ? `public, max-age=${String(ONE_YEAR_SECONDS)}, immutable`
          : 'no-cache',
      );
    },
  });

  app
    .getHttpAdapter()
    .getInstance()
    .get('/*', (request, reply) => {
      if (/^\/api(\/|\?|$)/.test(request.url)) {
        return reply.code(404).type('application/problem+json; charset=utf-8').send({
          type: 'https://errors.internal/not_found',
          title: 'Resource not found',
          status: 404,
          code: ErrorCode.NOT_FOUND,
          requestId: request.id,
        });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
}
