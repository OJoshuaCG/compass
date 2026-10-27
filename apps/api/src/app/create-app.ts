import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';

import { ProblemDetailsFilter } from '../shared/http/problem-details.filter.js';
import { AppModule } from './app.module.js';

/**
 * CSP estricta (docs/frontend.md §9): sin `unsafe-inline` ni `unsafe-eval`, scripts solo del
 * propio origen y sin poder ser embebida en un marco (clickjacking).
 */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
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

export async function createApp(options: { logger: Logger }): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // El identificador lo genera siempre el servidor: no se confía en uno enviado por el cliente.
    genReqId: () => uuidv7(),
    requestIdHeader: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter(options.logger));
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_POLICY },
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, _payload, done) => {
      void reply.header('x-request-id', request.id);
      done();
    });
  return app;
}
