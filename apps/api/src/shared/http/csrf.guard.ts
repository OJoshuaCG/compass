/**
 * Protección CSRF (plan: "Sesiones"): `SameSite` + cabecera personalizada obligatoria en las
 * peticiones que modifican + verificación de `Origin`. Un formulario de otro sitio no puede
 * fijar `X-Requested-With`, y un `Origin` ajeno se rechaza.
 */
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { DomainError } from '../kernel/index.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly allowedOrigin: string) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const requestedWith = request.headers['x-requested-with'];
    const origin = request.headers.origin;
    const headerOk = typeof requestedWith === 'string' && requestedWith !== '';
    const originOk = origin === undefined || origin === this.allowedOrigin;
    if (!headerOk || !originOk) {
      throw new DomainError('AUTHZ.PERMISSION', 'Cross-site request rejected');
    }
    return true;
  }
}
