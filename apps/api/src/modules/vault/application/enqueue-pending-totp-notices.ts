/**
 * Barrido que encuentra segundos factores registrados y SIN confirmar desde hace 24 horas o más, y encola
 * el aviso a quien los registró (S10, DF-6 de `two-factor.md`; ADR 0035).
 *
 * Corre dentro del sondeo del outbox (mismo hilo, misma activación `OUTBOX_WORKER_ENABLED`), organización por
 * organización con `TenantScope.runAs`, igual que la purga de efímeros (ADR 0038) y el trabajador: el barrido
 * nunca lee a través de organizaciones.
 *
 * Invariantes
 * - UNA sola vez por registro pendiente: reclamar (marcar `pending_notice_at`) y escribir el evento en
 *   `outbox_events` ocurren en la MISMA transacción. Si falla una, no queda ni la marca ni el evento, y el
 *   siguiente barrido lo reintenta; si ambas se confirman, la marca impide que vuelva a reclamarse. Un
 *   re-registro limpia la marca (ver `PgTotpRepository.replace`) y abre un plazo nuevo de 24 horas.
 * - El contenido del evento son solo ids y una fecha (ver `pending-totp-notice.ts`); aquí no se toca ningún
 *   secreto ni se descifra nada.
 * - Sin auditoría: igual que la purga, es mantenimiento del sistema sin actor y no revela ni cambia un
 *   secreto (decisión abierta anotada en `odd/tasks/phase-1b-worker.md`).
 * - Una organización con problemas no frena a las demás.
 */
import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { PENDING_TOTP_NOTICE_AFTER_MS } from '../domain/pending-totp-notice.js';
import type { PendingTotpNoticeStore } from './ports/pending-totp-notice-store.js';

/** Registros reclamados por transacción: acota el tiempo que se sostienen los bloqueos de fila. */
export const PENDING_TOTP_SWEEP_BATCH_SIZE = 100;

/**
 * Pausa mínima entre barridos. El sondeo del outbox corre cada pocos segundos, pero un aviso de 24 horas no
 * necesita esa frecuencia: con 5 minutos el aviso llega con un retraso máximo de 5 minutos sobre las 24 h.
 */
export const PENDING_TOTP_SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Fuente de organizaciones (solo ids); el cableado usa `auth.list_organization_ids()`. */
export interface PendingTotpSweepOrganizationSource {
  listIds(): Promise<readonly OrganizationId[]>;
}

export interface EnqueuePendingTotpNoticesDeps {
  readonly organizations: PendingTotpSweepOrganizationSource;
  readonly store: PendingTotpNoticeStore;
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface PendingTotpSweepOptions {
  /** Se consulta entre organizaciones y entre lotes: si devuelve `true` el barrido termina sin tomar más trabajo. */
  readonly isStopping?: () => boolean;
}

export interface PendingTotpSweepSummary {
  readonly organizations: number;
  /** Avisos encolados (y registros marcados) en esta pasada. */
  readonly enqueued: number;
  /** Organizaciones cuyo barrido falló por un error de infraestructura; las demás se procesaron igual. */
  readonly failedOrganizations: number;
}

export class EnqueuePendingTotpNotices {
  private lastRunAt: Date | null = null;

  constructor(private readonly deps: EnqueuePendingTotpNoticesDeps) {}

  /**
   * Barre solo si pasó `PENDING_TOTP_SWEEP_MIN_INTERVAL_MS` desde el último barrido; `null` si no tocaba.
   * El reloj se anota al empezar: un barrido que falla no se reintenta en bucle cada pocos segundos.
   */
  async executeIfDue(
    options: PendingTotpSweepOptions = {},
  ): Promise<PendingTotpSweepSummary | null> {
    const now = this.deps.clock.now();
    const isFirstRun = this.lastRunAt === null;
    const elapsedMs = this.lastRunAt === null ? 0 : now.getTime() - this.lastRunAt.getTime();
    if (!isFirstRun && elapsedMs < PENDING_TOTP_SWEEP_MIN_INTERVAL_MS) return null;
    this.lastRunAt = now;
    return this.execute(options);
  }

  async execute(options: PendingTotpSweepOptions = {}): Promise<PendingTotpSweepSummary> {
    const isStopping = options.isStopping ?? (() => false);
    const now = this.deps.clock.now();
    const registeredBefore = new Date(now.getTime() - PENDING_TOTP_NOTICE_AFTER_MS);
    const organizationIds = await this.deps.organizations.listIds();

    let enqueued = 0;
    let failedOrganizations = 0;
    for (const organizationId of organizationIds) {
      if (isStopping()) break;
      try {
        enqueued += await this.sweepOrganization(organizationId, registeredBefore, now, isStopping);
      } catch {
        // Una organización con problemas no debe impedir el barrido de las demás. Lo ya encolado de esta
        // organización en lotes anteriores quedó confirmado, así que no se descuenta.
        failedOrganizations += 1;
      }
    }
    return { organizations: organizationIds.length, enqueued, failedOrganizations };
  }

  /** Un lote por transacción hasta vaciar los vencidos de la organización. */
  private async sweepOrganization(
    organizationId: OrganizationId,
    registeredBefore: Date,
    noticeAt: Date,
    isStopping: () => boolean,
  ): Promise<number> {
    let enqueued = 0;
    for (;;) {
      if (isStopping()) return enqueued;
      const claimedInBatch = await this.deps.scope.runAs(
        { organizationId, actorId: null, requestId: this.deps.ids.next() },
        async () => {
          const due = await this.deps.store.claimDue(
            registeredBefore,
            noticeAt,
            PENDING_TOTP_SWEEP_BATCH_SIZE,
          );
          for (const notice of due) {
            await this.deps.store.enqueue(notice);
          }
          return due.length;
        },
      );
      enqueued += claimedInBatch;
      if (claimedInBatch < PENDING_TOTP_SWEEP_BATCH_SIZE) return enqueued;
    }
  }
}
