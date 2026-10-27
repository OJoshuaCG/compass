import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

import type { RequestContextRunner } from '../../../shared/kernel/index.js';
import './fastify-augment.js';

/** Token de inyección: lo provee la raíz de composición con el adaptador concreto. */
export const REQUEST_CONTEXT_RUNNER = Symbol('RequestContextRunner');

/**
 * Fija el `RequestContext` (organización, usuario, sesión) para toda la ejecución del manejador.
 * La organización sale de la sesión autenticada, nunca de un parámetro del cliente.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(@Inject(REQUEST_CONTEXT_RUNNER) private readonly contexts: RequestContextRunner) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (principal === undefined) return next.handle();
    return new Observable((subscriber) => {
      this.contexts.run(
        {
          organizationId: principal.organizationId,
          actorId: principal.userId,
          requestId: request.id,
          sessionId: principal.sessionId,
          reauthAt: principal.reauthAt,
        },
        () => {
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}
