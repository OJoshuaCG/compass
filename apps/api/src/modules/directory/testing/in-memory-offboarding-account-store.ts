import type { UserId } from '../../../shared/kernel/index.js';
import type {
  ManagementGrantOutcome,
  OffboardingAccountStore,
} from '../application/ports/offboarding-account-store.js';

/** Doble de `OffboardingAccountStore`: las cuentas huérfanas se declaran a mano y las concesiones se anotan. */
export class InMemoryOffboardingAccountStore implements OffboardingAccountStore {
  /** Cuentas que quedan huérfanas, por persona que se va. */
  readonly orphanedBy = new Map<string, readonly string[]>();
  /** Personas que ya tenían una compartición viva sobre la cuenta (`granted` pasa a `upgraded`). */
  readonly alreadyShared = new Set<string>();
  readonly grants: { accountId: string; granteeId: UserId; grantedBy: UserId }[] = [];

  lockAccountsOnlyManagedBy(leaverId: UserId): Promise<readonly string[]> {
    return Promise.resolve(this.orphanedBy.get(leaverId) ?? []);
  }

  grantManagement(input: {
    readonly accountId: string;
    readonly granteeId: UserId;
    readonly grantedBy: UserId;
  }): Promise<ManagementGrantOutcome> {
    this.grants.push({ ...input });
    const outcome = this.alreadyShared.has(`${input.accountId}:${input.granteeId}`)
      ? 'upgraded'
      : 'granted';
    return Promise.resolve(outcome);
  }
}
