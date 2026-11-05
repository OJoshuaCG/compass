import type { OffboardingAccessCleanup } from '../application/ports/offboarding-access-cleanup.js';
import type {
  LiveCredentialRef,
  NewOffboardingRotationTask,
  OffboardingRotationStore,
} from '../application/ports/offboarding-rotation-store.js';

/** Doble de `OffboardingAccessCleanup`: anota el orden de las llamadas para poder comprobarlo. */
export class InMemoryOffboardingAccessCleanup implements OffboardingAccessCleanup {
  exposedAccounts: readonly string[] = [];
  revokedShares = 0;
  removedGroups = 0;
  readonly calls: string[] = [];

  listAccountsWithViewOrMoreAccess(): Promise<readonly string[]> {
    this.calls.push('list');
    return Promise.resolve(this.exposedAccounts);
  }

  revokeDirectShares() {
    this.calls.push('revoke');
    return Promise.resolve(this.revokedShares);
  }

  removeFromAllGroups() {
    this.calls.push('groups');
    return Promise.resolve(this.removedGroups);
  }
}

/** Doble de `OffboardingRotationStore`: las credenciales vivas y las reveladas se declaran a mano. */
export class InMemoryOffboardingRotationStore implements OffboardingRotationStore {
  liveCredentials: readonly LiveCredentialRef[] = [];
  revealedCredentialIds: readonly string[] = [];
  readonly createdTasks: NewOffboardingRotationTask[] = [];

  listLiveCredentials(accountIds: readonly string[]): Promise<readonly LiveCredentialRef[]> {
    return Promise.resolve(
      this.liveCredentials.filter((credential) => accountIds.includes(credential.accountId)),
    );
  }

  listRevealedCredentialIds(input: {
    readonly userId: string;
    readonly credentialIds: readonly string[];
  }): Promise<readonly string[]> {
    return Promise.resolve(
      this.revealedCredentialIds.filter((id) => input.credentialIds.includes(id)),
    );
  }

  createTasks(tasks: readonly NewOffboardingRotationTask[]): Promise<number> {
    this.createdTasks.push(...tasks);
    return Promise.resolve(tasks.length);
  }
}
