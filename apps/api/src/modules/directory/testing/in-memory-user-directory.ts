import type { Rank, UserId } from '../../../shared/kernel/index.js';
import type {
  DirectoryPage,
  ManagedPage,
  NewUser,
  UserDirectory,
} from '../application/ports/user-directory.js';
import type { UserRecord, UserStatus } from '../domain/user.js';

/** Doble de prueba con la misma semántica de subárbol que la consulta recursiva real. */
export class InMemoryUserDirectory implements UserDirectory {
  readonly users = new Map<string, UserRecord>();

  add(user: UserRecord): void {
    this.users.set(user.id, user);
  }

  findById(id: UserId): Promise<UserRecord | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  existsByEmail(email: string): Promise<boolean> {
    return Promise.resolve([...this.users.values()].some((u) => u.email === email.toLowerCase()));
  }

  insert(user: NewUser): Promise<'inserted' | 'email_taken'> {
    if ([...this.users.values()].some((u) => u.email === user.email.toLowerCase())) {
      return Promise.resolve('email_taken');
    }
    this.users.set(user.id, { ...user, email: user.email.toLowerCase() });
    return Promise.resolve('inserted');
  }

  setStatus(id: UserId, status: UserStatus): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, status });
    return Promise.resolve();
  }

  isInSubtree(managerId: UserId, userId: UserId): Promise<boolean> {
    const seen = new Set<string>();
    let current = this.users.get(userId);
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.managedBy === managerId) return Promise.resolve(true);
      current = current.managedBy === null ? undefined : this.users.get(current.managedBy);
    }
    return Promise.resolve(false);
  }

  hasReports(userId: UserId): Promise<boolean> {
    return Promise.resolve(
      [...this.users.values()].some((u) => u.managedBy === userId && u.status !== 'deactivated'),
    );
  }

  lockHierarchy(): Promise<void> {
    return Promise.resolve();
  }

  setRank(id: UserId, rank: Rank): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, rank });
    return Promise.resolve();
  }

  setManager(id: UserId, managerId: UserId): Promise<void> {
    const user = this.users.get(id);
    if (user !== undefined) this.users.set(id, { ...user, managedBy: managerId });
    return Promise.resolve();
  }

  reassignReports(fromManagerId: UserId, toManagerId: UserId): Promise<number> {
    let moved = 0;
    for (const user of this.users.values()) {
      if (user.managedBy === fromManagerId && user.status !== 'deactivated') {
        this.users.set(user.id, { ...user, managedBy: toManagerId });
        moved += 1;
      }
    }
    return Promise.resolve(moved);
  }

  listManaged(): Promise<ManagedPage> {
    return Promise.resolve({ rows: [], nextCursor: null });
  }

  listAdministratorContacts(): Promise<
    readonly { readonly email: string; readonly locale: 'es-MX' | 'en-US' }[]
  > {
    return Promise.resolve(
      [...this.users.values()]
        .filter((u) => u.rank === 1 && u.status === 'active')
        .map((u) => ({ email: u.email, locale: u.locale })),
    );
  }

  list(): Promise<DirectoryPage> {
    return Promise.resolve({ rows: [], nextCursor: null });
  }
}
