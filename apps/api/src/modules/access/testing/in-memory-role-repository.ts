import type { Permission } from '@iam/contracts';

import type { UserId } from '../../../shared/kernel/index.js';
import type { RoleRecord, RoleRepository } from '../application/ports/role-repository.js';

export class InMemoryRoleRepository implements RoleRepository {
  readonly roles = new Map<string, RoleRecord>();
  readonly assignments = new Map<string, Set<string>>();

  addRole(role: RoleRecord): void {
    this.roles.set(role.id, role);
  }

  grant(userId: string, roleId: string): void {
    const set = this.assignments.get(userId) ?? new Set<string>();
    set.add(roleId);
    this.assignments.set(userId, set);
  }

  rolePermissionsOf(userId: UserId): Promise<readonly (readonly Permission[])[]> {
    const ids = [...(this.assignments.get(userId) ?? [])];
    return Promise.resolve(ids.map((id) => this.roles.get(id)?.permissions ?? []));
  }

  findByIds(ids: readonly string[]): Promise<readonly RoleRecord[]> {
    return Promise.resolve(
      ids.map((id) => this.roles.get(id)).filter((role): role is RoleRecord => role !== undefined),
    );
  }

  findSystemRole(name: string): Promise<RoleRecord | null> {
    return Promise.resolve(
      [...this.roles.values()].find((r) => r.isSystem && r.name === name) ?? null,
    );
  }

  assign(userId: UserId, roleId: string): Promise<void> {
    this.grant(userId, roleId);
    return Promise.resolve();
  }
}
