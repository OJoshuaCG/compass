import { AsyncLocalStorage } from 'node:async_hooks';

import { DomainError } from '../kernel/index.js';
import type { RequestContext, RequestContextReader } from '../kernel/index.js';

/** Transporta el `RequestContext` por la cadena asíncrona de la petición. */
export class AsyncLocalRequestContext implements RequestContextReader {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  current(): RequestContext {
    const context = this.storage.getStore();
    if (context === undefined) {
      // Falla cerrada: nada debe ejecutarse sin organización resuelta.
      throw new DomainError('AUTHZ.TENANT', 'No request context is active');
    }
    return context;
  }
}
