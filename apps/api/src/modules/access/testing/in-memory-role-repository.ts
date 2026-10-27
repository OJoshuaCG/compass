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

  listLive(): Promise<readonly RoleRecord[]> {
    return Promise.resolve([...this.roles.values()]);
  }

  insertCustom(input: {
    id: string;
    name: string;
    permissions: readonly Permission[];
  }): Promise<'inserted' | 'name_taken'> {
    const taken = [...this.roles.values()].some(
      (r) => r.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (taken) return Promise.resolve('name_taken');
    this.addRole({
      id: input.id,
      name: input.name,
      isSystem: false,
      permissions: input.permissions,
    });
    return Promise.resolve('inserted');
  }

  findLiveById(id: string): Promise<RoleRecord | null> {
    return Promise.resolve(this.roles.get(id) ?? null);
  }

  archive(id: string): Promise<void> {
    this.roles.delete(id);
    return Promise.resolve();
  }

  assign(userId: UserId, roleId: string): Promise<void> {
    this.grant(userId, roleId);
    return Promise.resolve();
  }
}
