import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';

import { IDEMPOTENT } from '../../../shared/http/http-decorators.js';
import { DomainError } from '../../../shared/kernel/index.js';
import { IdempotencyService } from '../application/idempotency-service.js';

/** Código que Nest aplicará a la respuesta (`@HttpCode`) o, por defecto, el de un POST. */
const HTTP_CODE_METADATA = '__httpCode__';
const DEFAULT_POST_STATUS = 201;

/**
 * Se ejecuta después del guard de sesión: solo actúa en rutas marcadas con `@Idempotent()`. Va
 * dentro del interceptor del contexto de petición, pero usa sus propias transacciones cortas.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IdempotencyService) private readonly service: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.get<boolean | undefined>(IDEMPOTENT, context.getHandler()) !== true) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (principal === undefined) {
      return throwError(() => new DomainError('AUTHZ.SESSION', 'Authentication required'));
    }
    let call;
    let hash;
    try {
      call = {
        organizationId: principal.organizationId,
        actorId: principal.userId,
        requestId: request.id,
        key: this.service.parseKey(request.headers['idempotency-key']),
      };
      hash = this.service.fingerprint(
        request.method,
        request.url.split('?')[0] ?? '',
        request.body,
      );
    } catch (error) {
      return throwError(() => error);
    }
    const status =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      DEFAULT_POST_STATUS;

    return from(this.service.begin(call, hash)).pipe(
      mergeMap((decision) => {
        if (decision.kind === 'replay') {
          context
            .switchToHttp()
            .getResponse<{ header(name: string, value: string): void }>()
            .header('idempotent-replayed', 'true');
          return of(decision.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            await this.service.complete(call, status, body);
            return body;
          }),
          catchError((error: unknown) =>
            from(this.service.release(call).catch(() => undefined)).pipe(
              mergeMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }
}
