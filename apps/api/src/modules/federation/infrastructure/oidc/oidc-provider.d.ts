/**
 * Tipos mínimos de `oidc-provider` 9.13.3 (el paquete no los trae y agregar `@types/oidc-provider` es una
 * dependencia nueva que requiere aprobación). Solo declara lo que Compass usa; amplíalo al usar más API.
 */
declare module 'oidc-provider' {
  import type { IncomingMessage, ServerResponse } from 'node:http';

  export type AdapterPayload = Record<string, unknown>;

  export interface Adapter {
    upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void>;
    find(id: string): Promise<AdapterPayload | undefined>;
    findByUid(uid: string): Promise<AdapterPayload | undefined>;
    findByUserCode(userCode: string): Promise<AdapterPayload | undefined>;
    consume(id: string): Promise<void>;
    destroy(id: string): Promise<void>;
    revokeByGrantId(grantId: string): Promise<void>;
  }

  export type AdapterConstructor = new (modelName: string) => Adapter;

  export interface ProviderConfiguration {
    readonly adapter?: AdapterConstructor;
    readonly [option: string]: unknown;
  }

  /** Interacción en curso (login o consentimiento) tal como la entrega `interactionDetails`. */
  export interface InteractionDetails {
    readonly uid: string;
    /** Segundos Unix en que el proveedor abrió la interacción. */
    readonly iat: number;
    readonly params: Readonly<Record<string, unknown>>;
    readonly prompt: {
      readonly name: string;
      readonly details: Readonly<Record<string, unknown>>;
    };
    readonly session?: { readonly accountId?: string };
  }

  export interface InteractionResult {
    readonly login?: {
      readonly accountId: string;
      readonly acr?: string;
      readonly amr?: readonly string[];
      /** `auth_time` en segundos Unix. */
      readonly ts?: number;
      readonly remember?: boolean;
    };
    readonly consent?: { readonly grantId: string };
    readonly error?: string;
    readonly error_description?: string;
  }

  export interface GrantInstance {
    addOIDCScope(scope: string): void;
    addOIDCClaims(claims: readonly string[]): void;
    addResourceScope(resource: string, scope: string): void;
    save(): Promise<string>;
  }

  export interface GrantConstructor {
    new (properties: { accountId: string; clientId: string }): GrantInstance;
  }

  export default class Provider {
    interactionDetails(
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<InteractionDetails>;
    interactionFinished(
      request: IncomingMessage,
      response: ServerResponse,
      result: InteractionResult,
      options?: { readonly mergeWithLastSubmission?: boolean },
    ): Promise<void>;
    readonly Grant: GrantConstructor;
    constructor(issuer: string, configuration: ProviderConfiguration);
    callback(): (request: IncomingMessage, response: ServerResponse) => void;
    readonly issuer: string;
    /** Detrás de un proxy inverso: confiar en `X-Forwarded-*` para construir las URL. */
    proxy: boolean;
  }
}
