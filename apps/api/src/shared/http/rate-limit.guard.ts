import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RateLimiterMemory } from 'rate-limiter-flexible';

import { DomainError } from '../kernel/index.js';
import { RATE_LIMITED } from './http-decorators.js';

/**
 * Límite por IP en las rutas de autenticación e invitación (60 por minuto). Es una primera barrera
 * barata; el bloqueo por correo y por usuario vive en los casos de uso. En memoria del proceso: con
 * varias instancias el límite es por instancia (el adaptador de Redis lo vuelve global).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new RateLimiterMemory({ points: 60, duration: 60 });

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Se decide por los metadatos de la ruta que Nest resolvió, no por el texto de la URL: una URL
    // con caracteres codificados (`%61uth`) llega al mismo manejador y no debe saltarse el límite.
    const limited = this.reflector.getAllAndOverride<boolean | undefined>(RATE_LIMITED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (limited !== true) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    try {
      await this.limiter.consume(request.ip);
      return true;
    } catch (rejection) {
      const retryMs = (rejection as { msBeforeNext?: number }).msBeforeNext ?? 1000;
      throw new DomainError('RATE_LIMITED', 'Too many requests', {
        retryAfterSeconds: Math.ceil(retryMs / 1000),
      });
    }
  }
}
