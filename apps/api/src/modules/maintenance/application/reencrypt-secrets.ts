import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { OrganizationLister } from './ports/purge-ports.js';
import type { ReencryptionBatchResult, SecretReencryptor } from './ports/reencryption-ports.js';

/** Filas por transacción: acota el tiempo que se sostienen los bloqueos de fila (ADR 0040). */
export const REENCRYPT_BATCH_SIZE = 200;

/**
 * Tope de lotes por tipo de secreto y organización en un pase. Evita un ciclo sin fin si algo
 * hiciera crecer el pendiente; lo que quede se retoma en el siguiente pase.
 */
export const MAX_BATCHES_PER_PASS = 10_000;

export interface ReencryptionOrganizationReport {
  readonly organizationId: OrganizationId;
  readonly resealed: number;
  readonly conflicts: number;
  readonly failed: number;
  /** Secretos que siguen en una versión anterior: mientras sea > 0 la versión vieja no se puede retirar. */
  readonly pending: number;
}

export interface ReencryptionSummary {
  readonly organizations: number;
  readonly resealed: number;
  readonly pending: number;
  readonly reports: readonly ReencryptionOrganizationReport[];
  /** Organizaciones que fallaron por completo; el resto se procesó igual. */
  readonly failedOrganizations: readonly { organizationId: OrganizationId; reason: string }[];
}

interface Dependencies {
  readonly organizations: OrganizationLister;
  readonly reencryptors: readonly SecretReencryptor[];
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Recifra con la DEK activa todo lo que siga en una versión anterior, organización por
 * organización y por lotes (ADR 0040). Es idempotente y reanudable: el pendiente son
 * exactamente las filas que aún tienen la versión vieja, así que no hay punto de control propio.
 * No escribe texto en claro en ningún registro: el resumen lleva solo conteos.
 */
export class ReencryptSecrets {
  constructor(private readonly deps: Dependencies) {}

  async execute(): Promise<ReencryptionSummary> {
    const organizationIds = await this.deps.organizations.listIds();
    const reports: ReencryptionOrganizationReport[] = [];
    const failedOrganizations: { organizationId: OrganizationId; reason: string }[] = [];

    for (const organizationId of organizationIds) {
      try {
        reports.push(await this.reencryptOrganization(organizationId));
      } catch (error) {
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return {
      organizations: organizationIds.length,
      resealed: reports.reduce((total, report) => total + report.resealed, 0),
      pending: reports.reduce((total, report) => total + report.pending, 0),
      reports,
      failedOrganizations,
    };
  }

  private async reencryptOrganization(
    organizationId: OrganizationId,
  ): Promise<ReencryptionOrganizationReport> {
    let resealed = 0;
    let conflicts = 0;
    let failed = 0;
    let pending = 0;

    for (const reencryptor of this.deps.reencryptors) {
      let cursor: string | null = null;
      for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch += 1) {
        const afterId: string | null = cursor;
        const result: ReencryptionBatchResult = await this.inBatch(organizationId, () =>
          reencryptor.reencryptBatch(organizationId, REENCRYPT_BATCH_SIZE, afterId),
        );
        resealed += result.resealed;
        conflicts += result.conflicts;
        failed += result.failed;
        // El cursor avanza aunque el lote no haya resellado nada: lo ilegible o bloqueado queda
        // pendiente, pero no debe impedir llegar a las filas sanas que vienen después.
        if (result.examined === 0 || result.lastId === null) break;
        cursor = result.lastId;
      }
      pending += await this.inBatch(organizationId, () => reencryptor.countPending(organizationId));
    }
    return { organizationId, resealed, conflicts, failed, pending };
  }

  /** Una transacción por lote, con la organización fijada y el aislamiento por filas normal. */
  private inBatch<T>(organizationId: OrganizationId, work: () => Promise<T>): Promise<T> {
    return this.deps.scope.runAs(
      { organizationId, actorId: null, requestId: this.deps.ids.next() },
      work,
    );
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
