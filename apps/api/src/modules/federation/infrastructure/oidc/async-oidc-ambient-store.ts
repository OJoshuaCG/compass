import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  OidcAmbientContext,
  OidcAmbientReader,
} from '../../application/ports/oidc-ambient.js';

/**
 * Transporta el contexto de la sesión de Compass por la cadena asíncrona de una petición `/oidc/*`.
 * Solo lo fija el montaje tras validar la cookie de Compass; sin él (p. ej. el punto de token) `current()`
 * devuelve `null` y el adaptador resuelve la organización por la clave consultada.
 */
export class AsyncOidcAmbientStore implements OidcAmbientReader {
  private readonly storage = new AsyncLocalStorage<OidcAmbientContext>();

  run<T>(context: OidcAmbientContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  current(): OidcAmbientContext | null {
    return this.storage.getStore() ?? null;
  }
}
