import { describe, expect, it } from 'vitest';

import { DomainError, asOrganizationId, err, ok } from '../../../shared/kernel/index.js';
import type { AuditEventInput, AuditEvent } from '../../audit/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { StoredSystemRole, SystemRoleStore } from './ports/system-role-ports.js';
import { joinForAudit, SyncSystemRoles } from './sync-system-roles.js';

const ORG_OK = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
const ORG_BROKEN = asOrganizationId('0198aaaa-0000-7000-8000-000000000002');
const ORG_OTHER = asOrganizationId('0198aaaa-0000-7000-8000-000000000003');

const TEMPLATES = [
  { name: 'Operator', permissions: ['account.view', 'credential.copy_username'] },
  { name: 'Leader', permissions: ['account.view', 'credential.reveal_password'] },
] as const;

/** Almacén en memoria con una lista de roles por organización; la organización en curso la fija el scope. */
class FakeStore implements SystemRoleStore {
  current: Map<string, StoredSystemRole[]> = new Map();
  active: string = ORG_OK;
  replaced: { roleId: string; permissions: readonly string[] }[] = [];

  listLiveSystemRoles(): Promise<readonly StoredSystemRole[]> {
    return Promise.resolve(this.current.get(this.active) ?? []);
  }

  replacePermissions(roleId: string, permissions: readonly string[]): Promise<boolean> {
    this.replaced.push({ roleId, permissions });
    for (const role of this.current.get(this.active) ?? []) {
      if (role.id === roleId) {
        (role as { permissions: readonly string[] }).permissions = permissions;
      }
    }
    return Promise.resolve(true);
  }
}

function build(store: FakeStore, organizations: readonly string[], auditLog?: AuditLog) {
  const events: AuditEventInput[] = [];
  const audit: AuditLog = auditLog ?? {
    record: (input) => {
      events.push(input);
      return Promise.resolve(ok(input as unknown as AuditEvent));
    },
  };
  const scope: TenantScope = {
    runAs: (context, fn) => {
      store.active = context.organizationId;
      if (context.organizationId === ORG_BROKEN) return Promise.reject(new Error('boom'));
      expect(context.actorId).toBeNull();
      return fn();
    },
    runAsAtomic: (_context, fn) => fn(),
  };
  const sync = new SyncSystemRoles({
    organizations: { listIds: () => Promise.resolve(organizations.map(asOrganizationId)) },
    store,
    audit,
    scope,
    ids: { next: () => 'req-1' },
    templates: TEMPLATES,
  });
  return { sync, events };
}

describe('SyncSystemRoles', () => {
  it('updates a system role that differs, with sorted removed/added names, and audits it', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OK, [
      {
        id: 'role-1',
        name: 'Operator',
        permissions: ['credential.reveal_password', 'account.view'],
      },
    ]);
    const { sync, events } = build(store, [ORG_OK]);

    const summary = await sync.execute();

    expect(summary).toEqual({ organizations: 1, rolesUpdated: 1, failedOrganizations: [] });
    expect(store.replaced).toEqual([
      { roleId: 'role-1', permissions: ['account.view', 'credential.copy_username'] },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'role.system_synced',
      actorId: null,
      targetType: 'role',
      targetId: 'role-1',
      outcome: 'success',
      metadata: {
        roleName: 'Operator',
        removed: 'credential.reveal_password',
        added: 'credential.copy_username',
      },
    });
  });

  it('keeps the audit lists within the 256 character limit of the audit metadata', async () => {
    const manyPermissions = Array.from(
      { length: 40 },
      (_, index) => `area.permission_${String(index)}`,
    );
    const store = new FakeStore();
    store.current.set(ORG_OK, [{ id: 'role-1', name: 'Operator', permissions: manyPermissions }]);
    const { sync, events } = build(store, [ORG_OK]);

    const summary = await sync.execute();

    expect(summary.failedOrganizations).toEqual([]);
    const removed = String(events[0]?.metadata['removed']);
    expect(removed.length).toBeLessThanOrEqual(256);
    expect(removed.endsWith('...')).toBe(true);
  });

  it('does not alter a list that already fits', () => {
    expect(joinForAudit(['a', 'b'])).toBe('a,b');
    expect(joinForAudit([])).toBe('');
  });

  it('is idempotent and ignores permission order', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OK, [
      { id: 'role-1', name: 'Operator', permissions: ['credential.copy_username', 'account.view'] },
    ]);
    const { sync, events } = build(store, [ORG_OK]);

    const first = await sync.execute();
    const second = await sync.execute();

    expect(first.rolesUpdated).toBe(0);
    expect(second.rolesUpdated).toBe(0);
    expect(store.replaced).toEqual([]);
    expect(events).toEqual([]);
  });

  it('converges: a second run after a change updates nothing', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OK, [{ id: 'role-1', name: 'Operator', permissions: ['account.view'] }]);
    const { sync, events } = build(store, [ORG_OK]);

    expect((await sync.execute()).rolesUpdated).toBe(1);
    expect((await sync.execute()).rolesUpdated).toBe(0);
    expect(events).toHaveLength(1);
  });

  it('leaves system roles without a template of the same name untouched', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OK, [{ id: 'role-9', name: 'Auditor', permissions: ['anything'] }]);
    const { sync, events } = build(store, [ORG_OK]);

    const summary = await sync.execute();

    expect(summary.rolesUpdated).toBe(0);
    expect(store.replaced).toEqual([]);
    expect(events).toEqual([]);
  });

  it('isolates a failing organization and exits the others normally', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OTHER, [{ id: 'role-2', name: 'Operator', permissions: ['x'] }]);
    const { sync } = build(store, [ORG_BROKEN, ORG_OTHER]);

    const summary = await sync.execute();

    expect(summary.organizations).toBe(2);
    expect(summary.rolesUpdated).toBe(1);
    expect(summary.failedOrganizations).toEqual([{ organizationId: ORG_BROKEN, reason: 'Error' }]);
  });

  it('fails the organization when the audit event cannot be recorded', async () => {
    const store = new FakeStore();
    store.current.set(ORG_OK, [{ id: 'role-1', name: 'Operator', permissions: ['x'] }]);
    const failing: AuditLog = {
      record: () => Promise.resolve(err(new DomainError('AUDIT.LOCK_TIMEOUT', 'lock'))),
    };
    const { sync } = build(store, [ORG_OK], failing);

    const summary = await sync.execute();

    expect(summary.rolesUpdated).toBe(0);
    expect(summary.failedOrganizations).toHaveLength(1);
  });
});
