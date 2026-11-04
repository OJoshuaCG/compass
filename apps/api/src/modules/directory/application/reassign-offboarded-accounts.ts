/**
 * Reasigna las cuentas que se quedan sin responsable cuando una persona se da de baja (ADR 0009, enmienda
 * 2026-11-04; docs/business/governance.md §2.4).
 *
 * Invariantes de seguridad
 * - Debe correr dentro de la transacción de la baja y DESPUÉS de tomar el bloqueo de jerarquía: el orden de
 *   bloqueos es jerarquía primero y cuentas por id después, para que dos bajas simultáneas no se crucen.
 * - Solo se reasignan las cuentas cuyo ÚNICO gestor activo es quien se va; una cuenta con otro gestor
 *   activo no se toca.
 * - Quien recibe las cuentas sale de la regla `selectAccountManager`: un superior activo que ya tiene por sí
 *   mismo los permisos. Este caso de uso nunca otorga un permiso ni elige a un par.
 * - Si nadie califica, la cuenta queda sin responsable y se informa: no se inventa un destinatario.
 * - Este caso de uso solo cambia quién gestiona; la auditoría, los avisos y las tareas de rotación los
 *   encadena quien lo llama con el informe que devuelve.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import { selectAccountManager } from '../domain/account-manager-selection.js';
import type {
  AccountManagerSelectionReason,
  ManagerCandidate,
} from '../domain/account-manager-selection.js';
import type { CandidatePermissionChecker } from './ports/candidate-permission-checker.js';
import type {
  ManagementGrantOutcome,
  OffboardingAccountStore,
} from './ports/offboarding-account-store.js';
import type { SuperiorLink, UserDirectory } from './ports/user-directory.js';

export interface ReassignOffboardedAccountsDeps {
  readonly directory: UserDirectory;
  readonly accounts: OffboardingAccountStore;
  readonly permissions: CandidatePermissionChecker;
}

export interface AccountReassignment {
  readonly accountId: string;
  readonly managerId: UserId;
  readonly reason: AccountManagerSelectionReason;
  /** `true` cuando quien recibe está fuera de la rama de quien dio la baja y hay que avisarle. */
  readonly notify: boolean;
  readonly grant: ManagementGrantOutcome;
}

export interface OffboardedAccountsReport {
  readonly reassigned: readonly AccountReassignment[];
  /** Cuentas que quedan sin responsable: nadie de la cadena califica. Hay que alertar a Administradores y Raíz. */
  readonly unassignedAccountIds: readonly string[];
}

const NO_ACCOUNTS_AFFECTED: OffboardedAccountsReport = {
  reassigned: [],
  unassignedAccountIds: [],
};

export class ReassignOffboardedAccounts {
  constructor(private readonly deps: ReassignOffboardedAccountsDeps) {}

  async run(input: {
    readonly leaverId: UserId;
    readonly actorId: UserId;
  }): Promise<OffboardedAccountsReport> {
    const { directory, accounts, permissions } = this.deps;

    const accountIds = await accounts.lockAccountsOnlyManagedBy(input.leaverId);
    // Sin cuentas huérfanas no hace falta recorrer la cadena ni consultar permisos.
    if (accountIds.length === 0) return NO_ACCOUNTS_AFFECTED;

    const superiors = await directory.listSuperiorChain(input.leaverId);
    const candidates = await this.describeCandidates(superiors, input.actorId, permissions);
    const selection = selectAccountManager(candidates);

    if (selection.outcome === 'unassigned') {
      return { reassigned: [], unassignedAccountIds: accountIds };
    }

    const reassigned: AccountReassignment[] = [];
    for (const accountId of accountIds) {
      const grant = await accounts.grantManagement({
        accountId,
        granteeId: selection.managerId,
        grantedBy: input.actorId,
      });
      reassigned.push({
        accountId,
        managerId: selection.managerId,
        reason: selection.reason,
        notify: selection.notify,
        grant,
      });
    }
    return { reassigned, unassignedAccountIds: [] };
  }

  /**
   * La cadena sube desde quien se va hasta la Raíz. Quien da la baja es un superior de esa persona, así que
   * su rama son los eslabones hasta él (incluido). Si por algún motivo no aparece en la cadena, ningún
   * eslabón se considera de su rama: se elige la opción más restrictiva.
   */
  private async describeCandidates(
    superiors: readonly SuperiorLink[],
    actorId: UserId,
    permissions: CandidatePermissionChecker,
  ): Promise<readonly ManagerCandidate[]> {
    const actorPosition = superiors.findIndex((superior) => superior.id === actorId);
    const candidates: ManagerCandidate[] = [];
    for (const [position, superior] of superiors.entries()) {
      // Quien no está activo no puede recibir la cuenta: se evita consultar sus permisos.
      const hasRequiredPermissions =
        superior.status === 'active' &&
        (await permissions.hasRequiredPermissions({ id: superior.id, rank: superior.rank }));
      candidates.push({
        id: superior.id,
        rank: superior.rank,
        status: superior.status,
        inActorBranch: actorPosition !== -1 && position <= actorPosition,
        hasRequiredPermissions,
      });
    }
    return candidates;
  }
}
