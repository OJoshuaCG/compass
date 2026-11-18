import type { IncomingMessage, ServerResponse } from 'node:http';

import type Provider from 'oidc-provider';
import type { InteractionDetails } from 'oidc-provider';

import type { InteractionProvider } from '../../application/ports/oidc-interaction-provider.js';

const readStringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readResourceScopes = (value: unknown): Readonly<Record<string, readonly string[]>> => {
  if (typeof value !== 'object' || value === null) return {};
  const scopes: Record<string, readonly string[]> = {};
  for (const [resource, list] of Object.entries(value)) {
    scopes[resource] = readStringList(list);
  }
  return scopes;
};

/**
 * Adapta el `Provider` de `oidc-provider` al puerto que usa el manejador de interacciones. `grantAll`
 * concede exactamente lo que el cliente pidió y el proveedor marcó como faltante: nada más.
 */
export function createInteractionProvider(
  provider: Provider,
): InteractionProvider<IncomingMessage, ServerResponse> {
  return {
    interactionDetails: (request, response) => provider.interactionDetails(request, response),
    interactionFinished: (request, response, result) =>
      provider.interactionFinished(request, response, result),
    grantAll: async (details: InteractionDetails, accountId: string, clientId: string) => {
      const grant = new provider.Grant({ accountId, clientId });
      for (const scope of readStringList(details.prompt.details['missingOIDCScope'])) {
        grant.addOIDCScope(scope);
      }
      const missingClaims = readStringList(details.prompt.details['missingOIDCClaims']);
      if (missingClaims.length > 0) grant.addOIDCClaims(missingClaims);
      const resourceScopes = readResourceScopes(details.prompt.details['missingResourceScopes']);
      for (const [resource, scopes] of Object.entries(resourceScopes)) {
        for (const scope of scopes) grant.addResourceScope(resource, scope);
      }
      return grant.save();
    },
  };
}
