/**
 * Matriz de autenticación por ruta (TODO D2).
 *
 * Falla si aparece un controlador o una ruta sin clasificar en `EXPECTED_ROUTES`, si la clasificación
 * del manifiesto no coincide con los decoradores reales (`@Public`, `@PartialSession`) o si una ruta
 * que exige sesión responde algo distinto de 401 sin cookie válida. Así, una ruta nueva no puede
 * quedar abierta por descuido: alguien tiene que declararla aquí, a la vista de la revisión.
 *
 * Alcance: solo comprueba la AUTENTICACIÓN a nivel de ruta. La autorización de cada acción la decide
 * el motor de acceso dentro del caso de uso y tiene sus propias pruebas de denegación.
 * Este manifiesto lo escribió el asistente: una persona debe revisarlo línea por línea (CLAUDE.md).
 */
import { randomUUID } from 'node:crypto';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ALLOWS_PARTIAL_SESSION, IS_PUBLIC } from '../src/shared/http/http-decorators.js';
import { APP_ORIGIN, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment } from './support/e2e.js';

type Access = 'public' | 'partial-session' | 'full-session';
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

const GLOBAL_PREFIX = '/api/v1';
const HTTP_UNAUTHENTICATED = 401;

/** Valores del enum `RequestMethod` de Nest, que es lo que guarda `METHOD_METADATA`. */
const METHOD_BY_NEST_CODE: Readonly<Record<number, Method>> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
};

const EXPECTED_ROUTES: Readonly<Record<string, Access>> = {
  'GET /health/live': 'public',

  'POST /auth/login': 'public',
  'POST /auth/passkey/options': 'partial-session',
  'POST /auth/passkey/verify': 'partial-session',
  'POST /auth/password/change': 'partial-session',
  'POST /auth/mfa/verify': 'partial-session',
  'POST /auth/mfa/recovery': 'partial-session',
  'POST /auth/mfa/totp/enroll': 'partial-session',
  'POST /auth/mfa/totp/confirm': 'partial-session',
  'POST /auth/logout': 'partial-session',
  'POST /auth/reauth': 'full-session',
  'POST /auth/reauth/passkey/options': 'full-session',
  'POST /auth/reauth/passkey/verify': 'full-session',

  'GET /me': 'full-session',
  'GET /me/passkeys': 'full-session',
  'POST /me/passkeys/registration/options': 'full-session',
  'POST /me/passkeys/registration/verify': 'full-session',
  'POST /me/passkeys/:id/revoke': 'full-session',
  'GET /me/sessions': 'full-session',
  'POST /me/sessions/:id/revoke': 'full-session',

  'GET /users': 'full-session',
  'GET /users/managed': 'full-session',
  'POST /users/:id/suspend': 'full-session',
  'POST /users/:id/reactivate': 'full-session',
  'POST /users/:id/deactivate': 'full-session',
  'POST /users/:id/sessions/revoke': 'full-session',
  'POST /users/:id/rank': 'full-session',
  'POST /users/:id/manager': 'full-session',

  'GET /roles': 'full-session',
  'POST /roles': 'full-session',
  'PATCH /roles/:id': 'full-session',
  'POST /organization/data-key/rotate': 'full-session',
  'POST /roles/:id/archive': 'full-session',

  'GET /invitations': 'full-session',
  'POST /invitations': 'full-session',
  'POST /invitations/:id/resend': 'full-session',
  'POST /invitations/preview': 'public',
  'POST /invitations/accept': 'public',
};

interface DiscoveredRoute {
  readonly key: string;
  readonly method: Method;
  readonly path: string;
  readonly access: Access;
}

function joinPath(...segments: readonly string[]): string {
  const joined = segments
    .map((segment) => segment.replaceAll(/^\/+|\/+$/g, ''))
    .filter((segment) => segment !== '')
    .join('/');
  return `/${joined}`;
}

function readFlag(metadataKey: string, handler: object, controller: object): boolean {
  const onHandler: unknown = Reflect.getMetadata(metadataKey, handler);
  const onController: unknown = Reflect.getMetadata(metadataKey, controller);
  return onHandler === true || onController === true;
}

function discoverRoutes(env: E2eEnvironment): DiscoveredRoute[] {
  const modules = env.app.get(ModulesContainer, { strict: false });
  const routes: DiscoveredRoute[] = [];

  for (const nestModule of modules.values()) {
    for (const wrapper of nestModule.controllers.values()) {
      const controller = wrapper.metatype;
      if (controller === null || typeof controller !== 'function') continue;
      const controllerPath: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (typeof controllerPath !== 'string') continue;

      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const nestMethod: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        if (typeof nestMethod !== 'number' || typeof methodPath !== 'string') continue;

        const method = METHOD_BY_NEST_CODE[nestMethod];
        if (method === undefined) {
          throw new Error(`Unsupported HTTP method code ${String(nestMethod)} in ${name}`);
        }
        const path = joinPath(controllerPath, methodPath);
        let access: Access = 'full-session';
        if (readFlag(IS_PUBLIC, handler, controller)) access = 'public';
        else if (readFlag(ALLOWS_PARTIAL_SESSION, handler, controller)) access = 'partial-session';
        routes.push({ key: `${method} ${path}`, method, path, access });
      }
    }
  }
  return routes;
}

let env: E2eEnvironment;
let routes: DiscoveredRoute[];

/** Rutas según lo que DECLARA el manifiesto (no según los decoradores), para que un decorador perdido no esconda la ruta de la prueba. */
function routesDeclared(...accesses: readonly Access[]): DiscoveredRoute[] {
  return routes.filter((route) => {
    const declared = EXPECTED_ROUTES[route.key];
    return declared !== undefined && accesses.includes(declared);
  });
}

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  routes = discoverRoutes(env);
});

afterAll(async () => {
  await env.close();
});

describe('route authentication matrix', () => {
  it('finds every route the API exposes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('has every route classified in the manifest, and no stale entries', () => {
    const discovered = routes.map((route) => route.key).sort();
    const declared = Object.keys(EXPECTED_ROUTES).sort();

    expect(discovered).toEqual(declared);
  });

  it('matches the manifest with the real decorators', () => {
    for (const route of routes) {
      expect(route.access, route.key).toBe(EXPECTED_ROUTES[route.key]);
    }
  });

  it('answers 401 without a session cookie on every route that is not public', async () => {
    for (const route of routesDeclared('full-session', 'partial-session')) {
      const response = await env.app.inject({
        method: route.method,
        url: `${GLOBAL_PREFIX}${route.path.replaceAll(':id', randomUUID())}`,
        remoteAddress: '203.0.113.50',
        headers:
          route.method === 'GET'
            ? {}
            : { 'x-requested-with': 'test', origin: APP_ORIGIN, 'idempotency-key': randomUUID() },
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });

      expect(response.statusCode, route.key).toBe(HTTP_UNAUTHENTICATED);
    }
  });

  it('answers 401 with a forged session cookie on every route that is not public', async () => {
    for (const route of routesDeclared('full-session', 'partial-session')) {
      const response = await env.app.inject({
        method: route.method,
        url: `${GLOBAL_PREFIX}${route.path.replaceAll(':id', randomUUID())}`,
        remoteAddress: '203.0.113.51',
        headers: {
          cookie: '__Host-session=forged-token-that-was-never-issued',
          ...(route.method === 'GET'
            ? {}
            : { 'x-requested-with': 'test', origin: APP_ORIGIN, 'idempotency-key': randomUUID() }),
        },
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });

      expect(response.statusCode, route.key).toBe(HTTP_UNAUTHENTICATED);
    }
  });

  it('does not reject public routes for lack of a session', async () => {
    for (const route of routesDeclared('public')) {
      const response = await env.app.inject({
        method: route.method,
        url: `${GLOBAL_PREFIX}${route.path}`,
        remoteAddress: '203.0.113.52',
        headers:
          route.method === 'GET'
            ? {}
            : { 'x-requested-with': 'test', origin: APP_ORIGIN, 'idempotency-key': randomUUID() },
        ...(route.method === 'GET' ? {} : { payload: {} }),
      });

      expect(response.statusCode, route.key).not.toBe(HTTP_UNAUTHENTICATED);
    }
  });
});
