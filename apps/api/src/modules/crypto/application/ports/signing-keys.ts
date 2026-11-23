export type SigningAlgorithm = 'ES256' | 'RS256';

/** JWK tal como lo exporta `node:crypto`: se trata como un objeto opaco que solo el emisor interpreta. */
export type Jwk = Readonly<Record<string, unknown>>;

export interface GeneratedSigningKey {
  readonly kid: string;
  readonly algorithm: SigningAlgorithm;
  readonly publicJwk: Jwk;
  readonly privateJwk: Jwk;
}

/** Genera pares de claves de firma. La implementación vive en `infrastructure` (única capa con `node:crypto`). */
export interface SigningKeyGenerator {
  generate(algorithm: SigningAlgorithm): GeneratedSigningKey;
}

export interface StoredSigningKey {
  readonly kid: string;
  readonly algorithm: SigningAlgorithm;
  readonly publicJwk: Jwk;
  /** Sobre cifrado por `PlatformEnvelope`; la clave privada nunca se guarda en claro. */
  readonly privateJwkCiphertext: Uint8Array;
}

/**
 * Almacén de claves de firma de la plataforma (tabla `oidc_signing_keys`, ADR 0052). No lleva
 * organización: es la única excepción a esa regla, y solo se alcanza por funciones de base de datos.
 */
export interface SigningKeyStore {
  /** Claves activas, de la más antigua a la más nueva. */
  listActive(): Promise<readonly StoredSigningKey[]>;
  /**
   * Guarda la clave y deja su fila en la auditoría de plataforma (`platform_audit_events`) en la misma
   * sentencia: si no se puede auditar, la clave no se guarda. `actor` es quien la añade.
   */
  add(key: StoredSigningKey, actor: string): Promise<void>;
  /**
   * Devuelve `false` si la clave no existe o ya estaba retirada (y entonces no audita nada). Si la retira,
   * audita con `actor` en la misma sentencia.
   */
  retire(kid: string, actor: string): Promise<boolean>;
}
