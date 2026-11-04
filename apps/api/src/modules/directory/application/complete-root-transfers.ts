/**
 * Proceso periódico de la transferencia de la Raíz: por organización, caduca la propuesta vieja o completa
 * la espera terminada (72 horas desde la aceptación). Lo invoca el script `main.complete-root-transfers.ts`.
 *
 * Invariantes de seguridad
 * - Corre en la transacción de la organización y bajo el bloqueo de jerarquía, igual que las acciones de
 *   las personas: nunca se cruza con otra mutación de la jerarquía.
 * - Sin transferencia abierta o con la espera sin cumplir no hace nada (es idempotente y seguro de repetir).
 * - Si la destinataria ya no es Administradora activa, cancela sola y avisa; nunca completa con datos viejos.
 */
import type { UnitOfWork } from '../../organization/index.js';
import type { RootTransferStore } from './ports/root-transfer-store.js';
import type { UserDirectory } from './ports/user-directory.js';
import type { RootTransferFinalizer, SettledOutcome } from './root-transfer-finalizer.js';

export interface CompleteRootTransfersDeps {
  readonly uow: UnitOfWork;
  readonly directory: UserDirectory;
  readonly store: RootTransferStore;
  readonly finalizer: RootTransferFinalizer;
}

export class CompleteRootTransfers {
  constructor(private readonly deps: CompleteRootTransfersDeps) {}

  /** Devuelve qué pasó con la transferencia abierta de la organización en curso, si la había. */
  run(): Promise<SettledOutcome | 'not_due' | 'none'> {
    return this.deps.uow.run(async () => {
      await this.deps.directory.lockHierarchy();
      const open = await this.deps.store.findOpenForUpdate();
      if (open === null) return 'none';
      return this.deps.finalizer.settleIfDue(open);
    });
  }
}
