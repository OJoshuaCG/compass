/**
 * Invariantes de seguridad
 * - La clave privada solo existe en claro dentro de esta clase y del proveedor OIDC; en reposo va
 *   siempre cifrada por `PlatformEnvelope`, con el `kid` y el algoritmo como contexto (AAD).
 * - Rotación en dos pasos (ADR 0052): primero `rotate()` publica la clave nueva; la más antigua
 *   sigue firmando hasta que `retire()` la quita. Así los clientes alcanzan a leer el JWKS nuevo.
 * - Nunca se registra ni se devuelve una clave privada en un error.
 */
import { DomainError } from '../../../shared/kernel/index.js';
import type { PlatformEnvelope } from './platform-envelope.js';
import type {
  Jwk,
  SigningAlgorithm,
  SigningKeyGenerator,
  SigningKeyStore,
  StoredSigningKey,
} from './ports/signing-keys.js';

const DEFAULT_ALGORITHM: SigningAlgorithm = 'ES256';
const PRIVATE_KEY_PURPOSE_PREFIX = 'oidc-signing-key';

export interface SigningKeySet {
  /** JWK privadas con `kid`, `alg` y `use`, en el formato que espera `oidc-provider` (`jwks.keys`). */
  readonly privateJwks: readonly Jwk[];
  /** Solo la parte pública: lo que se publica en `/jwks`. */
  readonly publicJwks: readonly Jwk[];
}

export interface SigningKeyServiceDeps {
  readonly store: SigningKeyStore;
  readonly generator: SigningKeyGenerator;
  readonly envelope: PlatformEnvelope;
}

/** El contexto de cifrado se ata al `kid` y al algoritmo: un sobre copiado a otra fila no abre. */
const purposeFor = (kid: string, algorithm: SigningAlgorithm): string =>
  `${PRIVATE_KEY_PURPOSE_PREFIX}|${kid}|${algorithm}`;

export class SigningKeyService {
  constructor(private readonly deps: SigningKeyServiceDeps) {}

  /** Crea la primera clave si todavía no hay ninguna activa. Idempotente. */
  async ensureActiveKey(): Promise<void> {
    const active = await this.deps.store.listActive();
    if (active.length === 0) await this.rotate();
  }

  /** Genera y guarda una clave nueva, sin retirar las existentes. Devuelve su `kid`. */
  async rotate(algorithm: SigningAlgorithm = DEFAULT_ALGORITHM): Promise<string> {
    const generated = this.deps.generator.generate(algorithm);
    const serialized = new TextEncoder().encode(JSON.stringify(generated.privateJwk));
    try {
      const privateJwkCiphertext = await this.deps.envelope.seal(
        purposeFor(generated.kid, generated.algorithm),
        serialized,
      );
      await this.deps.store.add({
        kid: generated.kid,
        algorithm: generated.algorithm,
        publicJwk: generated.publicJwk,
        privateJwkCiphertext,
      });
    } finally {
      serialized.fill(0);
    }
    return generated.kid;
  }

  /** Retira una clave. Se niega a retirar la última activa: el emisor se quedaría sin poder firmar. */
  async retire(kid: string): Promise<boolean> {
    const active = await this.deps.store.listActive();
    const isActive = active.some((key) => key.kid === kid);
    if (isActive && active.length === 1) {
      throw new DomainError(
        'CRYPTO.LAST_SIGNING_KEY',
        'The last active signing key cannot be retired',
      );
    }
    return this.deps.store.retire(kid);
  }

  async loadKeySet(): Promise<SigningKeySet> {
    const active = await this.deps.store.listActive();
    const privateJwks: Jwk[] = [];
    const publicJwks: Jwk[] = [];
    for (const key of active) {
      privateJwks.push(await this.openPrivateJwk(key));
      publicJwks.push(key.publicJwk);
    }
    return { privateJwks, publicJwks };
  }

  private async openPrivateJwk(key: StoredSigningKey): Promise<Jwk> {
    const plaintext = await this.deps.envelope.open(
      purposeFor(key.kid, key.algorithm),
      key.privateJwkCiphertext,
    );
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as Jwk;
    } finally {
      plaintext.fill(0);
    }
  }
}
