/**
 * Invariantes de seguridad
 * - Una transacción por organización, con su contexto fijado: el aislamiento por filas limita lo que se lee
 *   y lo que se registra a esa organización.
 * - El manifiesto se publica ANTES de confirmar el registro local: si la publicación falla, la transacción se
 *   revierte y no queda un ancla local sin su copia inmutable. Si falla la confirmación después de publicar,
 *   el bucket guarda un manifiesto de más con ese número; el verificador lo ve como versión repetida, no daño.
 * - El trabajo no está en la transacción de negocio: si falla, no bloquea ninguna escritura (ADR 0042).
 * - No escribe auditoría: es un trabajo de sistema sin actor, y un evento propio movería la cabeza que acaba
 *   de anclar.
 * - Si el ancla de una organización falla, se avisa a la Raíz en una transacción APARTE de esa organización:
 *   la del ancla ya se revirtió y se llevaría el aviso. Si tampoco se puede avisar, se informa en el resumen y
 *   se sigue con las demás; el código de salida 1 y el registro siguen siendo la última red.
 */
import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { toAuditAnchorManifest } from '../domain/audit-anchor.js';
import type {
  AnchorFailureAlerter,
  AnchorOrganizationLister,
  AuditAnchorLedger,
  AuditAnchorPublisher,
} from './ports/audit-anchor-ports.js';

/**
 * Años de calendario que el bucket retiene cada manifiesto sin permitir borrarlo ni sobrescribirlo. El ADR 0024
 * conserva la auditoría al menos 2 años y el ADR 0042 pide que el ancla cubra ese periodo. Son años de calendario
 * y no 730 días, que se quedan un día cortos cuando el periodo incluye un 29 de febrero. El plazo legal definitivo
 * (A10) sigue pendiente y, si fuera mayor, solo puede alargarse: el modo de cumplimiento no deja acortarlo.
 */
export const AUDIT_ANCHOR_RETENTION_YEARS = 2;

/** Misma fecha y hora, en UTC, tantos años después; un 29 de febrero pasa al 1 de marzo (nunca antes). */
export function auditAnchorRetainUntil(now: Date): Date {
  const retainUntil = new Date(now.getTime());
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + AUDIT_ANCHOR_RETENTION_YEARS);
  return retainUntil;
}

export interface AnchorFailure {
  readonly organizationId: OrganizationId;
  /** Nombre del error y, si lo hay, su código; nunca el mensaje, que puede traer datos. */
  readonly reason: string;
  /** `true` si quedó encolado el aviso a la Raíz; `false` si tampoco se pudo avisar. */
  readonly alerted: boolean;
}

export interface AnchorSummary {
  readonly organizations: number;
  readonly anchored: number;
  readonly failedOrganizations: readonly AnchorFailure[];
}

export class AnchorAuditChain {
  constructor(
    private readonly deps: {
      readonly organizations: AnchorOrganizationLister;
      readonly ledger: AuditAnchorLedger;
      readonly publisher: AuditAnchorPublisher;
      readonly scope: TenantScope;
      readonly ids: IdGenerator;
      readonly clock: Clock;
      readonly alerter: AnchorFailureAlerter;
    },
  ) {}

  async execute(): Promise<AnchorSummary> {
    const organizationIds = await this.deps.organizations.listIds();
    const startedAt = this.deps.clock.now();
    const retainUntil = auditAnchorRetainUntil(startedAt);
    const failedOrganizations: AnchorFailure[] = [];
    let anchored = 0;

    for (const organizationId of organizationIds) {
      try {
        await this.deps.scope.runAs(
          { organizationId, actorId: null, requestId: this.deps.ids.next() },
          async () => {
            const anchor = await this.deps.ledger.record(organizationId);
            await this.deps.publisher.publish(toAuditAnchorManifest(anchor), retainUntil);
          },
        );
        anchored += 1;
      } catch (error) {
        // Una organización que falla no debe dejar sin ancla a las demás.
        const alerted = await this.alertRoot(organizationId, startedAt);
        failedOrganizations.push({
          organizationId,
          reason: describeAnchorFailure(error),
          alerted,
        });
      }
    }

    return { organizations: organizationIds.length, anchored, failedOrganizations };
  }

  private async alertRoot(organizationId: OrganizationId, occurredAt: Date): Promise<boolean> {
    try {
      await this.deps.scope.runAs(
        { organizationId, actorId: null, requestId: this.deps.ids.next() },
        () => this.deps.alerter.alertAnchorFailed(occurredAt),
      );
      return true;
    } catch {
      // El motivo no se propaga: el resumen ya informa que esta organización quedó sin aviso.
      return false;
    }
  }
}

function describeAnchorFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
