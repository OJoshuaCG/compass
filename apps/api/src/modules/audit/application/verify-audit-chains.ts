/**
 * Invariantes de seguridad
 * - Solo lectura: cada organización se verifica en su propia transacción con su contexto fijado, de modo que el
 *   aislamiento por filas limita lo que `audit_verify_chain()` recorre a esa organización. No escribe auditoría ni
 *   alertas: es un trabajo de sistema sin actor.
 * - El resumen solo trae identificadores opacos, conteos y el `seq` de la primera ruptura: nunca hashes, claves ni
 *   contenido de eventos, para poder enviarlo a un registro o a un correo sin filtrar datos personales.
 * - Un error al verificar una organización NO se confunde con una cadena rota: se informa aparte y se sigue con
 *   las demás, para que una falla puntual no deje sin verificar al resto.
 */
import type { IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { AuditEventRepository } from './ports/audit-event-repository.js';
import type { AnchorOrganizationLister } from './ports/audit-anchor-ports.js';
import { VerifyAuditChain } from './verify-audit-chain.js';

export interface BrokenChain {
  readonly organizationId: OrganizationId;
  /** Primer `seq` cuya cadena no cuadra (hash, `prev_hash` o salto de `seq`). */
  readonly firstBrokenSeq: bigint;
}

export interface ChainVerificationFailure {
  readonly organizationId: OrganizationId;
  /** Nombre del error y, si lo hay, su código; nunca el mensaje, que puede traer datos. */
  readonly reason: string;
}

export interface ChainsVerificationSummary {
  readonly organizations: number;
  /** Organizaciones cuya cadena completa cuadra. */
  readonly valid: number;
  readonly brokenChains: readonly BrokenChain[];
  /** Organizaciones que no se pudieron verificar (no implica que su cadena esté rota). */
  readonly failedOrganizations: readonly ChainVerificationFailure[];
}

export class VerifyAuditChains {
  constructor(
    private readonly deps: {
      readonly organizations: AnchorOrganizationLister;
      readonly repository: AuditEventRepository;
      readonly scope: TenantScope;
      readonly ids: IdGenerator;
    },
  ) {}

  async execute(): Promise<ChainsVerificationSummary> {
    const organizationIds = await this.deps.organizations.listIds();
    const verifyChain = new VerifyAuditChain({ repository: this.deps.repository });
    const brokenChains: BrokenChain[] = [];
    const failedOrganizations: ChainVerificationFailure[] = [];
    let valid = 0;

    for (const organizationId of organizationIds) {
      try {
        const verification = await this.deps.scope.runAs(
          { organizationId, actorId: null, requestId: this.deps.ids.next() },
          () => verifyChain.execute(),
        );
        if (verification.valid) {
          valid += 1;
        } else {
          brokenChains.push({ organizationId, firstBrokenSeq: verification.firstBrokenSeq });
        }
      } catch (error) {
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return { organizations: organizationIds.length, valid, brokenChains, failedOrganizations };
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} (${code})` : error.name;
  }
  return 'UnknownError';
}
