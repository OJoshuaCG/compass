import type { FastifyReply } from 'fastify';

import './fastify-augment.js';

/**
 * Cookie de sesión (plan: "Sesiones"): `__Host-` obliga a `Secure`, `Path=/` y sin `Domain`;
 * `HttpOnly` la oculta a JavaScript; `SameSite=Lax` frena la mayoría de los CSRF.
 */
export const SESSION_COOKIE = '__Host-session';

const BASE = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  void reply.setCookie(SESSION_COOKIE, token, { ...BASE, expires: expiresAt });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, BASE);
}
