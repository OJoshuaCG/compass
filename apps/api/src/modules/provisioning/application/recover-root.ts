/**
 * Recuperación de la Raíz que perdió su contraseña y sus factores (ADR 0037). Comando de operaciones:
 * se ejecuta con una conexión de administración y nunca desde la API.
 *
 * Invariantes de seguridad
 * - Control dual: hacen falta dos códigos de emergencia vigentes de GRUPOS DE CUSTODIA distintos. Un
 *   solo custodio, aunque conserve todos sus papeles, no puede ejecutar la recuperación.
 * - Un rechazo no dice qué comprobación falló: quien prueba códigos no aprende cuál era válido.
 * - Los códigos y la contraseña nueva solo existen en memoria y en la salida del comando; a la base
 *   de datos y a la auditoría llegan únicamente hashes y conteos.
 * - Todo el cambio es atómico (lo garantiza el almacén): o la Raíz queda recuperada o no cambia nada.
 */
import { evaluatePassword, personalTokens } from '../../identity/index.js';
import type { PasswordHasher, PasswordStrength } from '../../identity/index.js';
import { hashEmergencyCode, issueEmergencyCodes } from './emergency-codes.js';
import type {
  CustodyGroup,
  EmergencyCodePrimitives,
  IssuedEmergencyCode,
} from './emergency-codes.js';
import { generateInitialPassword } from './initial-password.js';

export const ROOT_RECOVERY_REJECTED = 'ROOT_RECOVERY_REJECTED';

export class RootRecoveryRejectedError extends Error {
  readonly code = ROOT_RECOVERY_REJECTED;

  constructor() {
    // Mensaje único a propósito: ver el invariante sobre no revelar qué comprobación falló.
    super(
      'The recovery was rejected: the organization, the Root or the presented codes are not valid.',
    );
    this.name = 'RootRecoveryRejectedError';
  }
}

export interface RootIdentity {
  readonly organizationId: string;
  readonly rootUserId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface AdministratorContact {
  readonly email: string;
  readonly locale: 'es-MX' | 'en-US';
}

export interface RootRecoveryPlan {
  readonly root: RootIdentity;
  /** Hashes de los dos códigos presentados; el almacén comprueba que existan y sean de grupos distintos. */
  readonly presentedCodeHashes: readonly [Uint8Array, Uint8Array];
  readonly newPasswordHash: string;
  readonly newEmergencyCodes: readonly {
    readonly hash: Uint8Array;
    readonly custodyGroup: CustodyGroup;
  }[];
  readonly recoveredAt: Date;
}

export type RootRecoveryOutcome =
  | { readonly recovered: true; readonly administrators: readonly AdministratorContact[] }
  | { readonly recovered: false };

export interface RootRecoveryStore {
  /** La Raíz de la organización, o `null` si la organización no existe o no tiene Raíz. */
  findRoot(organizationSlug: string): Promise<RootIdentity | null>;
  /**
   * Verifica el control dual y aplica la recuperación en UNA transacción. Devuelve `recovered: false`
   * sin cambiar nada si la verificación falla.
   */
  recover(plan: RootRecoveryPlan): Promise<RootRecoveryOutcome>;
  /** Deja en la auditoría (`denied`) un intento de recuperación rechazado sobre una Raíz existente. */
  recordRejection(input: {
    readonly organizationId: string;
    readonly rootUserId: string;
  }): Promise<void>;
  /** Deja en la auditoría que el aviso a los Administradores no llegó completo. */
  recordAlertIncomplete(input: {
    readonly organizationId: string;
    readonly recipients: number;
    readonly failed: number;
  }): Promise<void>;
}

export interface AdministratorNotifier {
  /** Avisa a cada Administrador; devuelve cuántos avisos fallaron. Nunca lanza. */
  notify(administrators: readonly AdministratorContact[], recoveredAt: Date): Promise<number>;
}

export interface RootRecoveryInput {
  readonly organizationSlug: string;
  readonly presentedCodes: readonly [string, string];
}

export interface RootRecoveryResult {
  readonly organizationId: string;
  readonly rootUserId: string;
  readonly rootEmail: string;
  /** Contraseña de un solo uso: se entrega por un canal seguro y se cambia al entrar. */
  readonly initialPassword: string;
  /** Códigos nuevos, mostrados UNA vez, con el custodio de cada uno. */
  readonly emergencyCodes: readonly string[];
  readonly emergencyCodeGroups: readonly CustodyGroup[];
  readonly alert: { readonly recipients: number; readonly failed: number };
}

export class RecoverRoot {
  constructor(
    private readonly deps: {
      readonly store: RootRecoveryStore;
      readonly notifier: AdministratorNotifier;
      readonly hasher: PasswordHasher;
      readonly strength: PasswordStrength;
      readonly primitives: EmergencyCodePrimitives;
      readonly now: () => Date;
    },
  ) {}

  async execute(input: RootRecoveryInput): Promise<RootRecoveryResult> {
    const { store, notifier, hasher, strength, primitives, now } = this.deps;
    const [firstHash, secondHash] = input.presentedCodes.map((code) =>
      hashEmergencyCode(code, primitives.sha256),
    );
    const root = await store.findRoot(input.organizationSlug);
    // Sin Raíz no hay organización a la que atribuir el intento, así que este rechazo no se audita.
    if (root === null) throw new RootRecoveryRejectedError();

    // Dos veces el mismo papel no es control dual: se rechaza antes de generar nada ni cambiar datos.
    const presentsTwoDistinctCodes =
      firstHash !== undefined && secondHash !== undefined && !sameBytes(firstHash, secondHash);
    if (!presentsTwoDistinctCodes) {
      await this.auditRejection(root);
      throw new RootRecoveryRejectedError();
    }

    const tokens = personalTokens(root.email, root.displayName);
    const initialPassword = generateInitialPassword(
      { strength, randomBytes: primitives.randomBytes },
      tokens,
    );
    const problem = evaluatePassword({
      password: initialPassword,
      score: strength.score(initialPassword, tokens),
      personalTokens: tokens,
    });
    if (problem !== null) throw new Error(`The generated password is not acceptable: ${problem}`);

    const newEmergencyCodes: IssuedEmergencyCode[] = issueEmergencyCodes(primitives);
    const recoveredAt = now();
    const outcome = await store.recover({
      root,
      presentedCodeHashes: [firstHash, secondHash],
      newPasswordHash: await hasher.hash(initialPassword),
      newEmergencyCodes: newEmergencyCodes.map(({ hash, custodyGroup }) => ({
        hash,
        custodyGroup,
      })),
      recoveredAt,
    });
    if (!outcome.recovered) {
      await this.auditRejection(root);
      throw new RootRecoveryRejectedError();
    }

    // Ya confirmado el cambio, los códigos viejos están invalidados y los nuevos solo existen en
    // memoria: nada de lo que sigue puede impedir que el resultado llegue a quien opera, o la Raíz
    // quedaría sin acceso y sin forma de repetir la recuperación.
    const recipients = outcome.administrators.length;
    let failed: number;
    try {
      failed = await notifier.notify(outcome.administrators, recoveredAt);
    } catch {
      failed = recipients;
    }
    if (recipients === 0 || failed > 0) {
      try {
        await store.recordAlertIncomplete({
          organizationId: root.organizationId,
          recipients,
          failed,
        });
      } catch {
        // La salida del comando ya informa del aviso incompleto; solo falta su rastro en la auditoría.
      }
    }

    return {
      organizationId: root.organizationId,
      rootUserId: root.rootUserId,
      rootEmail: root.email,
      initialPassword,
      emergencyCodes: newEmergencyCodes.map((issued) => issued.code),
      emergencyCodeGroups: newEmergencyCodes.map((issued) => issued.custodyGroup),
      alert: { recipients, failed },
    };
  }

  // Un fallo al auditar no debe cambiar lo que ve quien prueba: el rechazo sigue siendo el mismo.
  private async auditRejection(root: RootIdentity): Promise<void> {
    try {
      await this.deps.store.recordRejection({
        organizationId: root.organizationId,
        rootUserId: root.rootUserId,
      });
    } catch {
      // Sin rastro adicional posible: la base de datos no respondió y el intento ya se rechazó.
    }
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
