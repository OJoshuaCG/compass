/**
 * Alta de una organización (script de operaciones, audita en el log del operador).
 *
 * Invariantes de seguridad
 * - Una organización nace con exactamente UNA Raíz (el índice único parcial de la base de datos lo garantiza).
 * - La contraseña inicial de la Raíz cumple la misma política que cualquier otra; el hash Argon2id
 *   es lo único que se guarda, y el usuario queda `invited` hasta registrar su segundo factor.
 * - Las plantillas de roles del sistema se siembran desde el código (versionadas), no a mano.
 */
import { SYSTEM_ROLES, SYSTEM_ROLES_VERSION } from '../../access/index.js';
import {
  EMERGENCY_CODE_COUNT,
  evaluatePassword,
  formatRecoveryCode,
  normalizeRecoveryCode,
  personalTokens,
  RECOVERY_CODE_RANDOM_BYTES,
} from '../../identity/index.js';
import type { PasswordHasher, PasswordStrength } from '../../identity/index.js';
import type { IdGenerator } from '../../../shared/kernel/index.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Mayor múltiplo de la longitud del alfabeto que cabe en un byte: descarta el resto (muestreo sin sesgo). */
const LIMIT = 256 - (256 % ALPHABET.length);

export interface BootstrapInput {
  readonly name: string;
  readonly slug: string;
  readonly rootEmail: string;
  readonly rootDisplayName: string;
  /** Si se omite, se genera una contraseña inicial aleatoria de un solo uso y se devuelve UNA vez. */
  readonly rootPassword?: string;
}

export interface OrganizationSeeder {
  /** Inserta organización, roles del sistema, la Raíz y su contraseña en UNA transacción. */
  seed(input: {
    readonly organizationId: string;
    readonly rootUserId: string;
    readonly name: string;
    readonly slug: string;
    readonly rootEmail: string;
    readonly rootDisplayName: string;
    readonly rootPasswordHash: string;
    /** SHA-256 de los códigos de emergencia de la Raíz (nunca el código). */
    readonly emergencyCodeHashes: readonly Uint8Array[];
    readonly roles: readonly { readonly name: string; readonly permissions: readonly string[] }[];
  }): Promise<void>;
}

export interface BootstrapResult {
  readonly organizationId: string;
  readonly rootUserId: string;
  readonly systemRolesVersion: number;
  /** Solo cuando se generó: la persona de operaciones la entrega por un canal seguro; se cambia al entrar. */
  readonly initialPassword: string | null;
  /** Se muestran UNA vez: se imprimen y los custodian dos personas fuera del sistema. */
  readonly emergencyCodes: readonly string[];
}

export class BootstrapOrganization {
  constructor(
    private readonly deps: {
      readonly seeder: OrganizationSeeder;
      readonly hasher: PasswordHasher;
      readonly strength: PasswordStrength;
      readonly ids: IdGenerator;
      /** Bytes aleatorios criptográficos (el dominio no importa `node:crypto`). */
      readonly randomBytes: (length: number) => Uint8Array;
      readonly sha256: (data: Uint8Array) => Uint8Array;
    },
  ) {}

  async execute(input: BootstrapInput): Promise<BootstrapResult> {
    const { seeder, hasher, strength, ids } = this.deps;
    const tokens = personalTokens(input.rootEmail.trim().toLowerCase(), input.rootDisplayName);
    const generated = input.rootPassword === undefined;
    const rootPassword = input.rootPassword ?? this.generatePassword(tokens);
    const email = input.rootEmail.trim().toLowerCase();
    const problem = evaluatePassword({
      password: rootPassword,
      score: strength.score(rootPassword, tokens),
      personalTokens: tokens,
    });
    if (problem !== null) throw new Error(`The root password is not acceptable: ${problem}`);

    const emergencyCodes = Array.from({ length: EMERGENCY_CODE_COUNT }, () =>
      formatRecoveryCode(this.deps.randomBytes(RECOVERY_CODE_RANDOM_BYTES)),
    );
    const organizationId = ids.next();
    const rootUserId = ids.next();
    await seeder.seed({
      organizationId,
      rootUserId,
      name: input.name,
      slug: input.slug,
      rootEmail: email,
      rootDisplayName: input.rootDisplayName.trim(),
      rootPasswordHash: await hasher.hash(rootPassword),
      emergencyCodeHashes: emergencyCodes.map((code) =>
        this.deps.sha256(new TextEncoder().encode(normalizeRecoveryCode(code))),
      ),
      roles: SYSTEM_ROLES.map((role) => ({ name: role.name, permissions: role.permissions })),
    });
    return {
      organizationId,
      rootUserId,
      systemRolesVersion: SYSTEM_ROLES_VERSION,
      initialPassword: generated ? rootPassword : null,
      emergencyCodes,
    };
  }

  /**
   * Contraseña inicial aleatoria de 24 caracteres sin símbolos ambiguos (0/O, 1/l/I), en grupos de
   * seis para dictarla o copiarla sin errores. Muestreo con rechazo: sin sesgo hacia ningún símbolo.
   */
  private generatePassword(tokens: readonly string[]): string {
    const { strength, randomBytes } = this.deps;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let raw = '';
      while (raw.length < 24) {
        for (const byte of randomBytes(48)) {
          if (byte < LIMIT && raw.length < 24) raw += ALPHABET.charAt(byte % ALPHABET.length);
        }
      }
      const candidate = (raw.match(/.{6}/g) ?? []).join('-');
      const problem = evaluatePassword({
        password: candidate,
        score: strength.score(candidate, tokens),
        personalTokens: tokens,
      });
      if (problem === null) return candidate;
    }
    throw new Error('Could not generate an acceptable initial password');
  }
}
