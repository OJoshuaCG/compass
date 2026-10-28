import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { ExpiredEphemeralStore, OrganizationLister } from './ports/purge-ports.js';

/**
 * Margen posterior al vencimiento antes de borrar. Una reserva de idempotencia o un desafío que
 * acaba de vencer aún puede estar siendo consultado por una petición en vuelo; borrarlo en el
 * mismo instante convertiría esa carrera en un error aleatorio.
 */
export const EXPIRED_RETENTION_GRACE_MS = 60 * 60 * 1000;

/** Filas por borrado: acota el tiempo que se sostienen los bloqueos de fila en cada sentencia. */
export const PURGE_BATCH_SIZE = 1000;

export interface OrganizationFailure {
  readonly organizationId: OrganizationId;
  /** Nombre del error y, si lo hay, su código (p. ej. SQLSTATE); nunca el mensaje, que puede traer datos. */
  readonly reason: string;
}

/** Conteo acumulado: lo ya borrado de una organización cuenta aunque un lote posterior falle. */
interface PurgeTally {
  idempotencyKeys: number;
  webauthnChallenges: number;
}

export interface PurgeSummary {
  readonly organizations: number;
  readonly idempotencyKeys: number;
  readonly webauthnChallenges: number;
  /** Organizaciones cuyo borrado falló; el resto se procesó igual. */
  readonly failedOrganizations: readonly OrganizationFailure[];
}

interface Dependencies {
  readonly organizations: OrganizationLister;
  readonly store: ExpiredEphemeralStore;
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Borra las filas efímeras vencidas (`idempotency_keys`, `webauthn_challenges`) organización por
 * organización, bajo el aislamiento por filas normal (ADR 0038). No genera auditoría: son datos de
 * mantenimiento sin significado de negocio, no una acción sensible.
 */
export class PurgeExpiredEphemeral {
  constructor(private readonly deps: Dependencies) {}

  async execute(): Promise<PurgeSummary> {
    const expiredBefore = new Date(this.deps.clock.now().getTime() - EXPIRED_RETENTION_GRACE_MS);
    const organizationIds = await this.deps.organizations.listIds();

    const tally: PurgeTally = { idempotencyKeys: 0, webauthnChallenges: 0 };
    const failedOrganizations: OrganizationFailure[] = [];

    for (const organizationId of organizationIds) {
      try {
        await this.purgeOrganization(organizationId, expiredBefore, tally);
      } catch (error) {
        // Una organización con problemas no debe impedir la limpieza de las demás.
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return {
      organizations: organizationIds.length,
      idempotencyKeys: tally.idempotencyKeys,
      webauthnChallenges: tally.webauthnChallenges,
      failedOrganizations,
    };
  }

  private async purgeOrganization(
    organizationId: OrganizationId,
    expiredBefore: Date,
    tally: PurgeTally,
  ): Promise<void> {
    await this.drain(
      (limit) =>
        this.inBatch(organizationId, () =>
          this.deps.store.purgeIdempotencyKeys(expiredBefore, limit),
        ),
      (deleted) => {
        tally.idempotencyKeys += deleted;
      },
    );
    await this.drain(
      (limit) =>
        this.inBatch(organizationId, () =>
          this.deps.store.purgeWebauthnChallenges(expiredBefore, limit),
        ),
      (deleted) => {
        tally.webauthnChallenges += deleted;
      },
    );
  }

  /** Una transacción por lote, para no sostener bloqueos durante toda la limpieza. */
  private inBatch(organizationId: OrganizationId, work: () => Promise<number>): Promise<number> {
    return this.deps.scope.runAs(
      { organizationId, actorId: null, requestId: this.deps.ids.next() },
      work,
    );
  }

  private async drain(
    deleteBatch: (limit: number) => Promise<number>,
    record: (deleted: number) => void,
  ): Promise<void> {
    for (;;) {
      const deleted = await deleteBatch(PURGE_BATCH_SIZE);
      record(deleted);
      if (deleted < PURGE_BATCH_SIZE) return;
    }
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
