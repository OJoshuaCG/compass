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

  export default class Provider {
    constructor(issuer: string, configuration: ProviderConfiguration);
    callback(): (request: IncomingMessage, response: ServerResponse) => void;
    readonly issuer: string;
    /** Detrás de un proxy inverso: confiar en `X-Forwarded-*` para construir las URL. */
    proxy: boolean;
  }
}
