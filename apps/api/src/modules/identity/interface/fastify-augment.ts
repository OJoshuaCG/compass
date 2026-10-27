import '@fastify/cookie';
import type { AuthenticatedPrincipal } from '../application/session-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Lo fija el guard de sesión tras validar la cookie; ausente en rutas públicas. */
    principal?: AuthenticatedPrincipal;
  }
}
