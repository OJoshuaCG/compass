import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';

import { ProblemDetailsFilter } from '../shared/http/problem-details.filter.js';
import { AppModule } from './app.module.js';
import { serveWebApp } from './serve-web.js';
import type { Container } from './container.js';

/**
 * CSP estricta (docs/frontend.md §9): sin `unsafe-inline` ni `unsafe-eval`, scripts solo del
 * propio origen y sin poder ser embebida en un marco (clickjacking).
 */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Radix inyecta una hoja de estilos fija al abrir un diálogo modal (bloqueo de scroll). Se permite
  // SOLO ese contenido exacto por su hash, no `unsafe-inline`. Si una actualización de Radix cambia
  // la hoja, la prueba de navegador (e2e) falla con el hash nuevo y se actualiza aquí.
  styleSrc: ["'self'", "'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  // Trusted Types: bloquea XSS por DOM (docs/frontend.md §9).
  requireTrustedTypesFor: ["'script'"],
} as const;

export interface CreateAppOptions {
  readonly logger: Logger;
  /** Sin contenedor solo se monta la comprobación de vida (útil para probar cabeceras sin base de datos). */
  readonly container?: Container;
  /** Origen del navegador permitido para las peticiones que modifican (verificación de `Origin`). */
  readonly appOrigin?: string;
  readonly trustProxy?: boolean;
  /** Carpeta con la SPA compilada (`apps/web/dist`); si se indica, la API la sirve en el mismo origen. */
  readonly webDistDir?: string;
}

export async function createApp(options: CreateAppOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // El identificador lo genera siempre el servidor: no se confía en uno enviado por el cliente.
    genReqId: () => uuidv7(),
    requestIdHeader: false,
    trustProxy: options.trustProxy ?? false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(options.container ?? null, options.appOrigin ?? 'http://localhost:5173'),
    adapter,
    { logger: false, abortOnError: false },
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter(options.logger));
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_POLICY },
  });
  if (options.webDistDir !== undefined) await serveWebApp(app, options.webDistDir);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, _payload, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });
  return app;
}
