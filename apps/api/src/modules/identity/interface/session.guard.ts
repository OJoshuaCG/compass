/**
 * Invariantes de seguridad
 * - Toda ruta exige sesión válida salvo las marcadas `@Public()`.
 * - Una sesión a medias (sin segundo factor verificado) solo entra a rutas `@PartialSession()`;
 *   en las demás se responde qué falta (registrar o verificar el segundo factor).
 * - El token viene solo de la cookie `HttpOnly`; nunca de un encabezado ni de la URL.
 */
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { DomainError } from '../../../shared/kernel/index.js';
import { SessionService } from '../application/session-service.js';
import './fastify-augment.js';
import { ALLOWS_PARTIAL_SESSION, IS_PUBLIC } from '../../../shared/http/http-decorators.js';
import { SESSION_COOKIE } from './session-cookie.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE];
    const principal =
      token === undefined ? null : await this.sessions.authenticate(token, request.id);
    if (principal === null) throw new DomainError('AUTHZ.SESSION', 'Authentication required');

    const partialAllowed =
      this.reflector.getAllAndOverride<boolean | undefined>(ALLOWS_PARTIAL_SESSION, targets) ===
      true;
    if (!principal.mfaVerified && !partialAllowed) {
      throw new DomainError(
        principal.userStatus === 'invited' ? 'AUTH.ENROLLMENT_REQUIRED' : 'AUTH.MFA_REQUIRED',
        'Second factor required',
      );
    }
    request.principal = principal;
    return true;
  }
}
