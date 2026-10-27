import type { UserId } from '../../../shared/kernel/index.js';
import type { DirectoryPage, NewUser, UserDirectory } from '../application/ports/user-directory.js';
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

  list(): Promise<DirectoryPage> {
    return Promise.resolve({ rows: [], nextCursor: null });
  }
}
