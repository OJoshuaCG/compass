import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type {
  ExpiredEphemeralStore,
  OrganizationLister,
  OutboxRetentionStore,
  ReplacedTotpSecretStore,
} from './ports/purge-ports.js';

/**
 * Margen posterior al vencimiento antes de borrar. Una reserva de idempotencia o un desafío que
 * acaba de vencer aún puede estar siendo consultado por una petición en vuelo; borrarlo en el
 * mismo instante convertiría esa carrera en un error aleatorio.
 */
export const EXPIRED_RETENTION_GRACE_MS = 60 * 60 * 1000;

/**
 * Días que se conserva una versión de secreto del segundo factor después de ser reemplazada por un
 * re-registro. Decisión del dueño (docs/business/two-factor.md DF-10 y docs/business/vault.md BO-6): sirve
 * para recuperar el cambio si la plataforma no aceptó el secreto nuevo. Es una constante, no una variable
 * de entorno: vault.md la llama "configurable", pero no hay pantalla ni variable definida (decisión abierta).
 */
export const REPLACED_TOTP_SECRET_RETENTION_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const REPLACED_TOTP_SECRET_RETENTION_MS =
  REPLACED_TOTP_SECRET_RETENTION_DAYS * MILLISECONDS_PER_DAY;

/**
 * Días que se conserva un evento del outbox ya publicado (y sus acuses de entrega) antes de borrarlo.
 * Decisión del dueño (D6): 7 días. Es una constante mientras no exista la tabla de ajustes del sistema; cuando
 * llegue, este valor vivirá en la base de datos y se podrá cambiar sin desplegar. Los eventos sin publicar y los
 * de cuarentena (dead letter) NO caducan nunca: requieren revisión humana.
 */
export const OUTBOX_RETENTION_DAYS = 7;
export const OUTBOX_RETENTION_MS = OUTBOX_RETENTION_DAYS * MILLISECONDS_PER_DAY;

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
  replacedTotpSecrets: number;
  outboxEvents: number;
  outboxDeliveries: number;
}

export interface PurgeSummary {
  readonly organizations: number;
  readonly idempotencyKeys: number;
  readonly webauthnChallenges: number;
  /** Versiones de secreto del segundo factor reemplazadas hace más de 30 días y ya destruidas. */
  readonly replacedTotpSecrets: number;
  /** Eventos del outbox publicados hace más de 7 días y ya borrados. */
  readonly outboxEvents: number;
  /** Acuses de entrega (`outbox_deliveries`) de esos eventos, borrados con ellos. */
  readonly outboxDeliveries: number;
  /** Organizaciones cuyo borrado falló; el resto se procesó igual. */
  readonly failedOrganizations: readonly OrganizationFailure[];
}

interface Dependencies {
  readonly organizations: OrganizationLister;
  readonly store: ExpiredEphemeralStore;
  readonly replacedTotpSecrets: ReplacedTotpSecretStore;
  readonly outboxRetention: OutboxRetentionStore;
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Borra las filas efímeras vencidas (`idempotency_keys`, `webauthn_challenges`) y las versiones de secreto
 * del segundo factor reemplazadas hace más de 30 días (H1b) y los eventos del outbox publicados hace más de 7 días
 * con sus acuses (D6), organización por organización, bajo el
 * aislamiento por filas normal (ADR 0038). No genera auditoría: son datos de mantenimiento sin actor,
 * no una acción sensible (decisión abierta para la purga de secretos: ver el ADR 0038).
 */
export class PurgeExpiredEphemeral {
  constructor(private readonly deps: Dependencies) {}

  async execute(): Promise<PurgeSummary> {
    const expiredBefore = new Date(this.deps.clock.now().getTime() - EXPIRED_RETENTION_GRACE_MS);
    const replacedBefore = new Date(
      this.deps.clock.now().getTime() - REPLACED_TOTP_SECRET_RETENTION_MS,
    );
    const publishedBefore = new Date(this.deps.clock.now().getTime() - OUTBOX_RETENTION_MS);
    const organizationIds = await this.deps.organizations.listIds();

    const tally: PurgeTally = {
      idempotencyKeys: 0,
      webauthnChallenges: 0,
      replacedTotpSecrets: 0,
      outboxEvents: 0,
      outboxDeliveries: 0,
    };
    const failedOrganizations: OrganizationFailure[] = [];

    for (const organizationId of organizationIds) {
      try {
        await this.purgeOrganization(
          organizationId,
          expiredBefore,
          replacedBefore,
          publishedBefore,
          tally,
        );
      } catch (error) {
        // Una organización con problemas no debe impedir la limpieza de las demás.
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return {
      organizations: organizationIds.length,
      idempotencyKeys: tally.idempotencyKeys,
      webauthnChallenges: tally.webauthnChallenges,
      replacedTotpSecrets: tally.replacedTotpSecrets,
      outboxEvents: tally.outboxEvents,
      outboxDeliveries: tally.outboxDeliveries,
      failedOrganizations,
    };
  }

  private async purgeOrganization(
    organizationId: OrganizationId,
    expiredBefore: Date,
    replacedBefore: Date,
    publishedBefore: Date,
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
    await this.drain(
      (limit) =>
        this.inBatch(organizationId, () =>
          this.deps.replacedTotpSecrets.purgeReplacedTotpSecrets(replacedBefore, limit),
        ),
      (deleted) => {
        tally.replacedTotpSecrets += deleted;
      },
    );
    // El lote lleno se decide por eventos; los acuses se suman aparte (un evento puede tener varios o ninguno).
    await this.drain(
      async (limit) => {
        const batch = await this.inBatch(organizationId, () =>
          this.deps.outboxRetention.purgePublishedEvents(publishedBefore, limit),
        );
        tally.outboxDeliveries += batch.deliveries;
        return batch.events;
      },
      (deleted) => {
        tally.outboxEvents += deleted;
      },
    );
  }

  /** Una transacción por lote, para no sostener bloqueos durante toda la limpieza. */
  private inBatch<Result>(
    organizationId: OrganizationId,
    work: () => Promise<Result>,
  ): Promise<Result> {
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

export function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
