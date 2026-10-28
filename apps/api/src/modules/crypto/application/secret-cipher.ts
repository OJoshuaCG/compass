/**
 * Invariantes de seguridad
 * - Es el único servicio que cifra y descifra secretos; ningún otro módulo toca `node:crypto`.
 * - Nonce aleatorio de 12 bytes por operación; nunca se reutiliza ni se acepta del llamador.
 * - El AAD (`org | recurso | campo | versión`) siempre se reconstruye aquí, nunca viene del texto cifrado.
 * - Los errores de descifrado son genéricos: no distinguen AAD, clave ni etiqueta incorrectos.
 * - Ningún valor en claro ni clave se registra, se serializa ni se devuelve en un error.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { OrganizationId, Result } from '../../../shared/kernel/index.js';
import { blindIndexInfo, utf8 } from '../domain/blind-index.js';
import type { BlindIndexPurpose } from '../domain/blind-index.js';
import { decryptFailed } from '../domain/crypto-errors.js';
import { toHex } from '../domain/hex.js';
import { buildAad } from '../domain/secret-context.js';
import type { EncryptedSecret, SecretContext } from '../domain/secret-context.js';
import type { DataKeyResolver } from './data-key-resolver.js';
import type { CryptoPrimitives } from './ports/crypto-primitives.js';

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

export interface SecretCipherDeps {
  readonly keys: DataKeyResolver;
  readonly primitives: CryptoPrimitives;
}

export interface BlindIndexValue {
  readonly index: string;
  readonly dekVersion: number;
}

export class SecretCipher {
  constructor(private readonly deps: SecretCipherDeps) {}

  async encrypt(
    context: SecretContext,
    plaintext: Uint8Array,
  ): Promise<Result<EncryptedSecret, DomainError>> {
    const { keys, primitives } = this.deps;
    try {
      return await keys.withActiveKey<Result<EncryptedSecret, DomainError>>(
        context.organizationId,
        (key, version) => {
          const nonce = primitives.randomBytes(NONCE_LENGTH);
          const ciphertext = primitives.aesGcmEncrypt({
            key,
            nonce,
            aad: buildAad(context),
            plaintext,
          });
          return ok({ ciphertext, nonce, dekVersion: version });
        },
      );
    } catch (error) {
      return domainFailure(error);
    }
  }

  async decrypt(
    context: SecretContext,
    secret: EncryptedSecret,
  ): Promise<Result<Uint8Array, DomainError>> {
    const { keys, primitives } = this.deps;
    if (secret.nonce.length !== NONCE_LENGTH || secret.ciphertext.length < TAG_LENGTH) {
      return err(decryptFailed());
    }
    try {
      return await keys.withKey<Result<Uint8Array, DomainError>>(
        context.organizationId,
        secret.dekVersion,
        (key) => {
          try {
            return ok(
              primitives.aesGcmDecrypt({
                key,
                nonce: secret.nonce,
                aad: buildAad(context),
                ciphertext: secret.ciphertext,
              }),
            );
          } catch {
            return err(decryptFailed());
          }
        },
      );
    } catch (error) {
      return domainFailure(error);
    }
  }

  /** Versión de DEK con la que se cifra hoy en la organización (la que fija `rotate()`). */
  async activeVersion(organizationId: OrganizationId): Promise<Result<number, DomainError>> {
    try {
      return ok(await this.deps.keys.withActiveKey(organizationId, (_key, version) => version));
    } catch (error) {
      return domainFailure(error);
    }
  }

  /**
   * Vuelve a cifrar un secreto con la DEK activa (ADR 0040). Lo abre con la versión con la que se
   * guardó y lo sella con la activa, con un nonce nuevo y el mismo contexto: el AAD no incluye la
   * versión de la DEK, así que el contexto no cambia. Devuelve `null` si ya está en la versión
   * activa. El texto en claro vive solo dentro de esta llamada y se borra de memoria al terminar.
   */
  async reseal(
    context: SecretContext,
    secret: EncryptedSecret,
  ): Promise<Result<EncryptedSecret | null, DomainError>> {
    const active = await this.activeVersion(context.organizationId);
    if (!active.ok) return err(active.error);
    if (secret.dekVersion === active.value) return ok(null);

    const opened = await this.decrypt(context, secret);
    if (!opened.ok) return err(opened.error);
    try {
      return await this.encrypt(context, opened.value);
    } finally {
      opened.value.fill(0);
    }
  }

  /**
   * Índice ciego (HMAC) para buscar por valor exacto sin guardar el texto, y huellas para
   * detectar reutilización de contraseñas. La clave se deriva de la DEK con HKDF y una
   * etiqueta por propósito. Como depende de la DEK, **cada rotación obliga a recalcular los
   * índices** (ver docs/backend.md §16); por eso se devuelve también la versión usada.
   */
  async blindIndex(
    organizationId: OrganizationId,
    purpose: BlindIndexPurpose,
    value: string,
    dekVersion?: number,
  ): Promise<Result<BlindIndexValue, DomainError>> {
    const { keys, primitives } = this.deps;
    const derive = (key: Uint8Array, version: number): Result<BlindIndexValue, DomainError> => {
      const indexKey = primitives.hkdfSha256({
        ikm: key,
        info: blindIndexInfo(purpose),
        length: 32,
      });
      try {
        return ok({
          index: toHex(primitives.hmacSha256(indexKey, utf8(value))),
          dekVersion: version,
        });
      } finally {
        indexKey.fill(0);
      }
    };
    try {
      return dekVersion === undefined
        ? await keys.withActiveKey(organizationId, derive)
        : await keys.withKey(organizationId, dekVersion, (key) => derive(key, dekVersion));
    } catch (error) {
      return domainFailure(error);
    }
  }
}

function domainFailure(error: unknown): Result<never, DomainError> {
  // Solo los errores esperados del dominio se convierten en resultado; el resto es un bug.
  if (error instanceof DomainError) return err(error);
  throw error;
}
