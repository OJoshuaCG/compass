import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { describeFailure } from './purge-expired-ephemeral.js';
import type { OrganizationLister } from './ports/purge-ports.js';
import type {
  QuarantineAlertHistory,
  QuarantineAlerter,
  QuarantinedEventCounter,
} from './ports/quarantine-alert-ports.js';

/**
 * Cada cuánto se vuelve a avisar mientras sigan existiendo eventos en cuarentena. Un aviso por día evita
 * inundar el chat de Telegram si nadie revisa los eventos de inmediato; el sondeo puede correr más seguido
 * y aun así no repite el mensaje.
 */
export const QUARANTINE_ALERT_REPEAT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface QuarantineCheckFailure {
  readonly organizationId: OrganizationId;
  /** Nombre del error y su código, nunca el mensaje, que puede traer datos. */
  readonly reason: string;
}

export interface QuarantineCheckSummary {
  readonly organizations: number;
  /** Organizaciones con al menos un evento en cuarentena. */
  readonly organizationsWithQuarantinedEvents: number;
  /** Alertas encoladas en esta pasada (las que ya tenían aviso reciente no cuentan). */
  readonly alertsEnqueued: number;
  readonly failedOrganizations: readonly QuarantineCheckFailure[];
}

interface Dependencies {
  readonly organizations: OrganizationLister;
  readonly counter: QuarantinedEventCounter;
  readonly history: QuarantineAlertHistory;
  readonly alerter: QuarantineAlerter;
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/**
 * Revisa, organización por organización y bajo el aislamiento por filas normal, si hay eventos del outbox
 * en cuarentena (dead letter) y, de haberlos, encola la alerta `events_quarantined` para la Raíz. Solo
 * cuenta filas: no lee ni registra el contenido de los eventos. Los eventos en cuarentena nunca caducan
 * (ver la purga), así que esta alerta es la única señal de que alguien debe revisarlos.
 */
export class CheckQuarantinedEvents {
  constructor(private readonly deps: Dependencies) {}

  async execute(): Promise<QuarantineCheckSummary> {
    const organizationIds = await this.deps.organizations.listIds();
    const failedOrganizations: QuarantineCheckFailure[] = [];
    let organizationsWithQuarantinedEvents = 0;
    let alertsEnqueued = 0;

    for (const organizationId of organizationIds) {
      try {
        const outcome = await this.checkOrganization(organizationId);
        if (outcome.hasQuarantinedEvents) organizationsWithQuarantinedEvents += 1;
        if (outcome.alertEnqueued) alertsEnqueued += 1;
      } catch (error) {
        // Una organización con problemas no debe impedir la revisión de las demás.
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return {
      organizations: organizationIds.length,
      organizationsWithQuarantinedEvents,
      alertsEnqueued,
      failedOrganizations,
    };
  }

  private checkOrganization(
    organizationId: OrganizationId,
  ): Promise<{ hasQuarantinedEvents: boolean; alertEnqueued: boolean }> {
    // Una sola transacción: contar, consultar el historial y encolar se confirman o se revierten juntos.
    return this.deps.scope.runAs(
      { organizationId, actorId: null, requestId: this.deps.ids.next() },
      async () => {
        const quarantinedEvents = await this.deps.counter.countQuarantinedEvents();
        if (quarantinedEvents === 0) return { hasQuarantinedEvents: false, alertEnqueued: false };

        const now = this.deps.clock.now();
        const repeatSince = new Date(now.getTime() - QUARANTINE_ALERT_REPEAT_INTERVAL_MS);
        const alreadyAlerted = await this.deps.history.hasQuarantineAlertSince(repeatSince);
        if (alreadyAlerted) return { hasQuarantinedEvents: true, alertEnqueued: false };

        await this.deps.alerter.alertQuarantinedEvents(now);
        return { hasQuarantinedEvents: true, alertEnqueued: true };
      },
    );
  }
}
