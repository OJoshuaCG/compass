/**
 * Lo que la baja de una persona hace en la bóveda y en los grupos (docs/business/governance.md §2.1 y §2.4,
 * ADR 0009, enmienda 2026-11-04). Encadena, en este orden y dentro de la transacción de la baja:
 *
 * 1. Leer las cuentas a las que la persona tiene acceso de VER o más. Debe ir primero: al retirar los
 *    accesos ya no queda rastro de cuáles eran.
 * 2. Reasignar las cuentas que se quedan sin responsable (`ReassignOffboardedAccounts`). Debe ir antes de
 *    retirar comparticiones: la cuenta se considera huérfana por la compartición vigente de la persona.
 * 3. Retirar sus comparticiones directas y sacarla de los grupos.
 * 4. Exigir la rotación de TODAS las credenciales vivas de esas cuentas, en 72 horas; con prioridad alta las
 *    que la persona llegó a revelar.
 *
 * Invariantes de seguridad
 * - El llamador ya tiene el bloqueo de jerarquía; este caso de uso no lo toma. Las cuentas huérfanas se
 *   bloquean por id dentro de `ReassignOffboardedAccounts`, después de la jerarquía y antes de la auditoría.
 * - Quien recibe las tareas de rotación ya tiene `rotation.manage` (la regla de selección lo exige). Si la
 *   cadena no tiene a nadie que califique, las recibe la Raíz activa. Sin Raíz activa no se puede dar la
 *   baja: es preferible fallar y deshacer la transacción a dejar credenciales expuestas sin quien rote.
 * - Este caso de uso no audita ni avisa: devuelve un informe con el que quien lo llama encadena ambas cosas.
 */
import type { Clock, UserId } from '../../../shared/kernel/index.js';
import type { OffboardingAccessCleanup } from './ports/offboarding-access-cleanup.js';
import type {
  NewOffboardingRotationTask,
  OffboardingRotationStore,
} from './ports/offboarding-rotation-store.js';
import type {
  OffboardedAccountsReport,
  OffboardingReceiver,
  ReassignOffboardedAccounts,
} from './reassign-offboarded-accounts.js';

/** Plazo de la rotación tras una baja (governance §2.4). */
export const OFFBOARDING_ROTATION_DEADLINE_HOURS = 72;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface OffboardAccountsDeps {
  readonly reassignment: ReassignOffboardedAccounts;
  readonly cleanup: OffboardingAccessCleanup;
  readonly rotation: OffboardingRotationStore;
  readonly clock: Clock;
}

export interface OffboardAccountsReport {
  readonly reassignment: OffboardedAccountsReport;
  readonly exposedAccountCount: number;
  readonly revokedShareCount: number;
  readonly removedGroupMembershipCount: number;
  readonly rotationTasksCreated: number;
  /** `null` cuando no había credenciales que rotar. */
  readonly rotationAssigneeId: UserId | null;
}

export class OffboardAccounts {
  constructor(private readonly deps: OffboardAccountsDeps) {}

  async run(input: {
    readonly leaverId: UserId;
    readonly actorId: UserId;
  }): Promise<OffboardAccountsReport> {
    const { reassignment, cleanup } = this.deps;

    const exposedAccountIds = await cleanup.listAccountsWithViewOrMoreAccess(input.leaverId);

    const receiver = await reassignment.selectReceiver(input);
    const reassignmentReport = await reassignment.run({ ...input, receiver });

    const revokedShareCount = await cleanup.revokeDirectShares({
      userId: input.leaverId,
      revokedBy: input.actorId,
    });
    const removedGroupMembershipCount = await cleanup.removeFromAllGroups(input.leaverId);

    const rotation = await this.requestRotation({
      leaverId: input.leaverId,
      exposedAccountIds,
      receiver,
    });

    return {
      reassignment: reassignmentReport,
      exposedAccountCount: exposedAccountIds.length,
      revokedShareCount,
      removedGroupMembershipCount,
      rotationTasksCreated: rotation.created,
      rotationAssigneeId: rotation.assigneeId,
    };
  }

  private async requestRotation(input: {
    readonly leaverId: UserId;
    readonly exposedAccountIds: readonly string[];
    readonly receiver: OffboardingReceiver;
  }): Promise<{ readonly created: number; readonly assigneeId: UserId | null }> {
    const { rotation, clock } = this.deps;
    if (input.exposedAccountIds.length === 0) return { created: 0, assigneeId: null };

    const credentials = await rotation.listLiveCredentials(input.exposedAccountIds);
    if (credentials.length === 0) return { created: 0, assigneeId: null };

    const assigneeId = this.rotationAssignee(input.receiver);
    const credentialIds = credentials.map((credential) => credential.credentialId);
    const revealed = new Set(
      await rotation.listRevealedCredentialIds({
        userId: input.leaverId,
        credentialIds,
      }),
    );

    const dueAt = new Date(
      clock.now().getTime() + OFFBOARDING_ROTATION_DEADLINE_HOURS * MILLISECONDS_PER_HOUR,
    );
    const tasks: NewOffboardingRotationTask[] = credentialIds.map((credentialId) => ({
      credentialId,
      triggeredBy: input.leaverId,
      assignedTo: assigneeId,
      priority: revealed.has(credentialId) ? 'high' : 'normal',
      dueAt,
    }));

    const created = await rotation.createTasks(tasks);
    return { created, assigneeId };
  }

  private rotationAssignee(receiver: OffboardingReceiver): UserId {
    if (receiver.selection.outcome === 'assigned') return receiver.selection.managerId;
    if (receiver.rootId !== null) return receiver.rootId;
    throw new Error('Offboarding needs an active Root to receive the rotation tasks');
  }
}
