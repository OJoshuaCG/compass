import { describe, expect, it } from 'vitest';

import type { OidcAmbientContext } from '../../application/ports/oidc-ambient.js';
import { AsyncOidcAmbientStore } from './async-oidc-ambient-store.js';

const contextOf = (organizationId: string): OidcAmbientContext => ({
  organizationId,
  userId: 'user-1',
  compassSessionId: 'session-1',
});

describe('AsyncOidcAmbientStore', () => {
  it('sin contexto fijado devuelve null, como en el punto de token', () => {
    expect(new AsyncOidcAmbientStore().current()).toBeNull();
  });

  it('expone el contexto dentro de la cadena asíncrona y no fuera de ella', async () => {
    const store = new AsyncOidcAmbientStore();
    const inside = await store.run(contextOf('org-1'), async () => {
      await Promise.resolve();
      return store.current();
    });

    expect(inside).toEqual(contextOf('org-1'));
    expect(store.current()).toBeNull();
  });

  it('dos peticiones concurrentes no se mezclan el contexto', async () => {
    const store = new AsyncOidcAmbientStore();
    const observe = (organizationId: string, delayMs: number) =>
      store.run(contextOf(organizationId), async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return store.current()?.organizationId;
      });

    const [slow, fast] = await Promise.all([observe('org-slow', 20), observe('org-fast', 1)]);

    expect(slow).toBe('org-slow');
    expect(fast).toBe('org-fast');
  });

  it('un contexto anidado manda dentro y el exterior se restaura al salir', () => {
    const store = new AsyncOidcAmbientStore();
    const seen: (string | undefined)[] = [];
    store.run(contextOf('outer'), () => {
      store.run(contextOf('inner'), () => seen.push(store.current()?.organizationId));
      seen.push(store.current()?.organizationId);
    });

    expect(seen).toEqual(['inner', 'outer']);
  });
});
