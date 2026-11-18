/**
 * Cableado del proveedor OIDC (ADR 0050-0052): junta el adaptador a PostgreSQL, las claves de firma, el
 * proveedor `oidc-provider` y el manejador de interacciones. Solo se construye con `OIDC_ENABLED=true`.
 */
import type { Pool } from 'pg';

import { DomainError, asOrganizationId } from '../shared/kernel/index.js';
import type { Clock, IdGenerator } from '../shared/kernel/index.js';
import type { Authorizer } from '../modules/access/index.js';
import type { CryptoPrimitives, SecretCipher, SigningKeyService } from '../modules/crypto/index.js';
import type { UserDirectory } from '../modules/directory/index.js';
import {
  AsyncOidcAmbientStore,
  OidcInteractionHandler,
  PgOidcClientStore,
  PgOidcOrgResolver,
  createInteractionProvider,
  createOidcProvider,
  createPgOidcAdapter,
} from '../modules/federation/index.js';
import type { InteractionPrincipal } from '../modules/federation/index.js';
import type { SessionService } from '../modules/identity/index.js';
import type { TenantScope, TransactionProvider } from '../modules/organization/index.js';
import { asUserId } from '../shared/kernel/index.js';

export interface OidcWiringDeps {
  readonly pool: Pool;
  readonly scope: TenantScope;
  readonly transactions: TransactionProvider;
  readonly primitives: CryptoPrimitives;
  readonly cipher: SecretCipher;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly sessions: SessionService;
  readonly authorizer: Authorizer;
  readonly directory: UserDirectory;
  readonly signingKeys: SigningKeyService;
}

export interface OidcWiringSettings {
  /** `APP_ORIGIN`: el emisor único. */
  readonly issuer: string;
  readonly cookieKeys: readonly string[];
  readonly idTokenSigningAlg: 'ES256' | 'RS256';
}

export interface OidcWiring {
  readonly provider: ReturnType<typeof createOidcProvider>;
  readonly interaction: OidcInteractionHandler;
}

export async function buildOidcWiring(
  deps: OidcWiringDeps,
  settings: OidcWiringSettings,
): Promise<OidcWiring> {
  const { pool, scope, transactions, ids, clock, sessions, authorizer, directory } = deps;

  // Sin clave activa el emisor no puede firmar: la primera vez se crea, las siguientes no hace nada.
  await deps.signingKeys.ensureActiveKey();
  const keySet = await deps.signingKeys.loadKeySet();

  const resolver = new PgOidcOrgResolver(pool);
  const ambient = new AsyncOidcAmbientStore();
  const clients = new PgOidcClientStore(transactions);

  const adapter = createPgOidcAdapter({
    scope,
    transactions,
    resolver,
    ambient,
    primitives: deps.primitives,
    cipher: deps.cipher,
    ids,
    clock,
  });

  const provider = createOidcProvider({
    issuer: settings.issuer,
    adapter,
    privateJwks: keySet.privateJwks,
    cookieKeys: settings.cookieKeys,
    idTokenSigningAlg: settings.idTokenSigningAlg,
    interactionUrl: (uid) => `/oidc/interaction/${encodeURIComponent(uid)}`,
    loadAccountClaims: async (accountId, clientId) => {
      // En el punto de token no hay sesión de Compass: la organización sale del cliente, que es de la misma
      // organización que la persona (decisión 3A).
      if (clientId === null) return null;
      const organizationId = await resolver.byActiveClientId(clientId);
      if (organizationId === null) return null;
      const user = await scope.runAs(
        { organizationId: asOrganizationId(organizationId), actorId: null, requestId: ids.next() },
        () => directory.findById(asUserId(accountId)),
      );
      if (user === null || user.status !== 'active') return null;
      return { name: user.displayName, email: user.email };
    },
  });

  const interaction = new OidcInteractionHandler({
    provider: createInteractionProvider(provider),
    authenticate: async (token, requestId): Promise<InteractionPrincipal | null> => {
      const principal = await sessions.authenticate(token, requestId);
      if (principal === null) return null;
      return {
        sessionId: principal.sessionId,
        organizationId: principal.organizationId,
        userId: principal.userId,
        mfaAt: principal.mfaAt,
      };
    },
    resolveClientOrganization: (clientId) => resolver.byActiveClientId(clientId),
    checkEntry: (principal, clientId, requestId) =>
      scope.runAs(
        {
          organizationId: asOrganizationId(principal.organizationId),
          actorId: asUserId(principal.userId),
          requestId,
        },
        async () => {
          const client = await clients.findActiveByClientId(clientId);
          if (client === null) return { allowed: false, isExternal: false };
          try {
            await authorizer.requireClientEntry(client.maxRank);
            return { allowed: true, isExternal: client.isExternal };
          } catch (error) {
            // La negación ya quedó auditada por el autorizador; cualquier otro error se propaga.
            if (error instanceof DomainError)
              return { allowed: false, isExternal: client.isExternal };
            throw error;
          }
        },
      ),
    runWithAmbient: (context, fn) => ambient.run(context, fn),
    now: () => clock.now(),
  });

  return { provider, interaction };
}
