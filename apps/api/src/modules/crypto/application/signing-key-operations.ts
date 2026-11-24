/**
 * Operaciones de la consola de claves de firma OIDC (runbook `rotate-oidc-signing-keys`).
 *
 * Auditoría: el servicio escribe cada alta y retiro en `platform_audit_events` (opción C, ADR 0052)
 * con el actor `os:<usuario>`. Además, cada acción devuelve un registro de una sola línea (acción,
 * kid, algoritmo, hora UTC y usuario del sistema operativo) que la persona operadora adjunta al ticket.
 *
 * Nunca se imprime ni se devuelve material de la clave privada.
 */
import type { Clock } from '../../../shared/kernel/index.js';
import type { SigningAlgorithm } from './ports/signing-keys.js';
import { SigningKeyCommandError } from './signing-key-command-error.js';
import type { SigningKeyService } from './signing-key-service.js';

export type SigningKeyAction = 'list' | 'rotate' | 'retire';

export interface SigningKeyRecord {
  readonly action: SigningKeyAction;
  readonly kid: string;
  readonly algorithm: SigningAlgorithm;
  readonly occurredAt: Date;
  /** Usuario del sistema operativo que ejecutó el comando. */
  readonly operator: string;
}

export interface SigningKeyOperationsDeps {
  readonly service: SigningKeyService;
  readonly clock: Clock;
  readonly operator: string;
}

export class SigningKeyOperations {
  constructor(private readonly deps: SigningKeyOperationsDeps) {}

  async list(): Promise<readonly SigningKeyRecord[]> {
    const active = await this.deps.service.listActiveKeys();
    return active.map((key) => this.record('list', key.kid, key.algorithm));
  }

  /** Publica una clave nueva sin retirar las existentes (paso 1 de la rotación, ADR 0052). */
  async rotate(algorithm: SigningAlgorithm = 'ES256'): Promise<SigningKeyRecord> {
    const kid = await this.deps.service.rotate(algorithm);
    return this.record('rotate', kid, algorithm);
  }

  /** Retira una clave activa (paso 2). El servicio se niega a retirar la última. */
  async retire(kid: string): Promise<SigningKeyRecord> {
    const active = await this.deps.service.listActiveKeys();
    const target = active.find((key) => key.kid === kid);
    if (target === undefined) throw notFound(kid);

    const retired = await this.deps.service.retire(kid);
    // Si otra persona la retiró entre la consulta y el retiro, esta ejecución no hizo nada.
    if (!retired) throw notFound(kid);
    return this.record('retire', kid, target.algorithm);
  }

  private record(
    action: SigningKeyAction,
    kid: string,
    algorithm: SigningAlgorithm,
  ): SigningKeyRecord {
    return {
      action,
      kid,
      algorithm,
      occurredAt: this.deps.clock.now(),
      operator: this.deps.operator,
    };
  }
}

const notFound = (kid: string): SigningKeyCommandError =>
  new SigningKeyCommandError('SIGNING_KEY_NOT_FOUND', `No hay una clave activa con kid ${kid}`);

/** Una sola línea de JSON: `JSON.stringify` escapa los saltos de línea del nombre de usuario. */
export function formatSigningKeyRecord(record: SigningKeyRecord): string {
  return JSON.stringify({
    event: 'oidc_signing_key',
    action: record.action,
    kid: record.kid,
    alg: record.algorithm,
    at: record.occurredAt.toISOString(),
    os_user: record.operator,
  });
}
