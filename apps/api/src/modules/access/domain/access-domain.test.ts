import { PERMISSIONS } from '@iam/contracts';
import type { Permission } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import { decide } from './decision.js';
import type { DecisionInput } from './decision.js';
import { effectivePermissions } from './effective-permissions.js';
import { PERMISSION_CEILING, REAUTH_WINDOW_MS } from './permission-catalog.js';
import { checkRoleAssignment, isSubsetOfCreator } from './role-assignment.js';
import { SYSTEM_ROLES, systemRole } from './system-roles.js';

const RANKS: readonly Rank[] = [0, 1, 2, 3];

// Tabla del plan ("Catálogo de permisos"), escrita a mano: permiso -> techo.
const PLAN_CEILINGS: ReadonlyArray<readonly [string, Rank]> = [
  ['org.settings', 0],
  ['role.manage', 1],
  ['platform.manage', 1],
  ['vault.inventory.read', 1],
  ['vault.emergency_access', 1],
  ['audit.read_all', 1],
  ['sso.clients.manage', 1],
  ['user.invite', 2],
  ['user.update', 2],
  ['user.change_rank', 1],
  ['user.transfer', 2],
  ['user.deactivate', 2],
  ['role.assign', 2],
  ['group.create', 2],
  ['group.manage_members', 2],
  ['account.create', 3],
  ['account.update', 3],
  ['account.archive', 2],
  ['credential.create', 3],
  ['credential.update', 3],
  ['credential.reveal_password', 3],
  ['credential.use_totp', 3],
  ['credential.export_totp', 2],
  ['share.manage', 3],
  ['access_request.approve', 2],
  ['rotation.manage', 2],
  ['audit.read_scope', 2],
];

describe('permission catalog', () => {
  it('has the 27 permissions of the plan, each with the ceiling the plan states', () => {
    expect(PERMISSIONS).toHaveLength(27);
    expect(PLAN_CEILINGS).toHaveLength(27);
    for (const [permission, ceiling] of PLAN_CEILINGS) {
      expect(PERMISSION_CEILING[permission as Permission], permission).toBe(ceiling);
    }
  });

  it('assigns a ceiling to every catalog permission (none is missing)', () => {
    for (const permission of PERMISSIONS) expect(PERMISSION_CEILING[permission]).toBeDefined();
  });
});

describe('system role templates', () => {
  it('Root has every permission', () => {
    expect(new Set(systemRole('root').permissions)).toEqual(new Set(PERMISSIONS));
  });

  it('Administrator has everything except organization settings', () => {
    const admin = new Set(systemRole('administrator').permissions);
    expect(admin.has('org.settings')).toBe(false);
    expect(admin.size).toBe(PERMISSIONS.length - 1);
  });

  it('Leader and Operator only hold permissions their rank can have', () => {
    for (const permission of systemRole('leader').permissions) {
      expect(PERMISSION_CEILING[permission]).toBeGreaterThanOrEqual(2);
    }
    for (const permission of systemRole('operator').permissions) {
      expect(PERMISSION_CEILING[permission]).toBe(3);
    }
  });

  it('an Operator can use the vault day to day but cannot reveal passwords, manage people or export 2FA secrets', () => {
    const operator = new Set(systemRole('operator').permissions);
    for (const allowed of ['account.create', 'credential.use_totp', 'share.manage']) {
      expect(operator.has(allowed as Permission), allowed).toBe(true);
    }
    for (const denied of [
      'credential.reveal_password',
      'user.invite',
      'credential.export_totp',
      'role.manage',
      'audit.read_all',
    ]) {
      expect(operator.has(denied as Permission), denied).toBe(false);
    }
  });

  it('has exactly one template per actor', () => {
    expect(SYSTEM_ROLES.map((role) => role.key).sort()).toEqual([
      'administrator',
      'leader',
      'operator',
      'root',
    ]);
  });
});

describe('effective permissions', () => {
  it('is the union of roles clipped by the rank ceiling', () => {
    const result = effectivePermissions([['user.invite', 'org.settings'], ['account.create']], 2);
    expect([...result].sort()).toEqual(['account.create', 'user.invite']);
  });

  it('drops permissions above the ceiling for every rank', () => {
    for (const rank of RANKS) {
      const granted = effectivePermissions([PERMISSIONS], rank);
      for (const permission of PERMISSIONS) {
        expect(granted.has(permission), `${permission} @ rank ${String(rank)}`).toBe(
          rank <= PERMISSION_CEILING[permission],
        );
      }
    }
  });

  it('recomputes from the current rank: a demoted Leader loses leader-only permissions', () => {
    const roles = [systemRole('leader').permissions];
    expect(effectivePermissions(roles, 2).has('user.invite')).toBe(true);
    expect(effectivePermissions(roles, 3).has('user.invite')).toBe(false);
    expect(effectivePermissions(roles, 3).has('account.create')).toBe(true);
  });

  it('is empty without roles', () => {
    expect(effectivePermissions([], 0).size).toBe(0);
  });
});

describe('role assignment (no escalation)', () => {
  const leaderPermissions = new Set(systemRole('leader').permissions);

  it('allows assigning a role the actor fully holds to a managed person within its ceiling', () => {
    expect(
      checkRoleAssignment({
        actorManagesTarget: true,
        actorPermissions: leaderPermissions,
        rolePermissions: ['account.create', 'share.manage'],
        targetRank: 3,
      }),
    ).toBeNull();
  });

  it('refuses when the actor does not manage the target', () => {
    expect(
      checkRoleAssignment({
        actorManagesTarget: false,
        actorPermissions: leaderPermissions,
        rolePermissions: ['account.create'],
        targetRank: 3,
      }),
    ).toBe('NOT_MANAGED');
  });

  it('refuses a role containing a permission the actor does not have', () => {
    expect(
      checkRoleAssignment({
        actorManagesTarget: true,
        actorPermissions: leaderPermissions,
        rolePermissions: ['account.create', 'role.manage'],
        targetRank: 3,
      }),
    ).toBe('ESCALATION');
  });

  it('refuses a permission above the target rank ceiling even if the actor holds it', () => {
    expect(
      checkRoleAssignment({
        actorManagesTarget: true,
        actorPermissions: leaderPermissions,
        rolePermissions: ['user.invite'],
        targetRank: 3,
      }),
    ).toBe('CEILING');
  });

  it('a custom role must be a subset of its creator permissions', () => {
    expect(isSubsetOfCreator(['account.create'], leaderPermissions)).toBe(true);
    expect(isSubsetOfCreator(['account.create', 'org.settings'], leaderPermissions)).toBe(false);
  });
});

describe('decision engine', () => {
  const ORG = asOrganizationId('0198aaaa-0000-7000-8000-000000000001');
  const OTHER = asOrganizationId('0198bbbb-0000-7000-8000-000000000002');
  const now = new Date('2026-06-01T12:00:00.000Z');
  const base: DecisionInput = {
    permission: 'account.create',
    contextOrganizationId: ORG,
    resourceOrganizationId: ORG,
    actorActive: true,
    sessionValid: true,
    actorPermissions: new Set<Permission>(['account.create', 'credential.reveal_password']),
    reauthAt: null,
    now,
  };

  it('allows a permitted action with no obligations', () => {
    expect(decide(base)).toEqual({ allowed: true, obligations: [] });
  });

  it('denies a resource of another organization first, even with every other condition met', () => {
    expect(decide({ ...base, resourceOrganizationId: OTHER })).toEqual({
      allowed: false,
      reason: 'TENANT',
    });
    expect(decide({ ...base, resourceOrganizationId: OTHER, actorActive: false })).toEqual({
      allowed: false,
      reason: 'TENANT',
    });
  });

  it('denies an inactive actor or an invalid session', () => {
    expect(decide({ ...base, actorActive: false })).toEqual({ allowed: false, reason: 'SESSION' });
    expect(decide({ ...base, sessionValid: false })).toEqual({ allowed: false, reason: 'SESSION' });
  });

  it('denies an action the actor has no permission for', () => {
    expect(decide({ ...base, permission: 'user.invite' })).toEqual({
      allowed: false,
      reason: 'PERMISSION',
    });
  });

  it('denies a user-targeted action when the actor does not manage the target', () => {
    expect(decide({ ...base, managesTargetUser: false })).toEqual({
      allowed: false,
      reason: 'HIERARCHY',
    });
    expect(decide({ ...base, managesTargetUser: true })).toEqual({
      allowed: true,
      obligations: [],
    });
  });

  it('checks the permission before the hierarchy', () => {
    expect(decide({ ...base, permission: 'user.invite', managesTargetUser: false })).toEqual({
      allowed: false,
      reason: 'PERMISSION',
    });
  });

  describe('step-up (reauthentication)', () => {
    const reveal: DecisionInput = { ...base, permission: 'credential.reveal_password' };

    it('denies revealing a password without a recent reauthentication', () => {
      expect(decide(reveal)).toEqual({ allowed: false, reason: 'REAUTH' });
    });

    it('allows within five minutes and returns the written-reason obligation', () => {
      const reauthAt = new Date(now.getTime() - REAUTH_WINDOW_MS);
      expect(decide({ ...reveal, reauthAt })).toEqual({
        allowed: true,
        obligations: ['REAUTH', 'WRITTEN_REASON'],
      });
    });

    it('denies once the five-minute window has passed', () => {
      const reauthAt = new Date(now.getTime() - REAUTH_WINDOW_MS - 1);
      expect(decide({ ...reveal, reauthAt })).toEqual({ allowed: false, reason: 'REAUTH' });
    });

    it('exporting a 2FA secret and emergency access also require a critical audit event', () => {
      const reauthAt = new Date(now.getTime() - 1000);
      const perms = new Set<Permission>(['credential.export_totp', 'vault.emergency_access']);
      expect(
        decide({
          ...base,
          actorPermissions: perms,
          permission: 'credential.export_totp',
          reauthAt,
        }),
      ).toEqual({
        allowed: true,
        obligations: ['REAUTH', 'WRITTEN_REASON', 'CRITICAL_AUDIT'],
      });
      expect(
        decide({
          ...base,
          actorPermissions: perms,
          permission: 'vault.emergency_access',
          reauthAt,
        }),
      ).toEqual({
        allowed: true,
        obligations: ['REAUTH', 'WRITTEN_REASON', 'CRITICAL_AUDIT'],
      });
    });

    it('the permission check still wins over reauthentication', () => {
      expect(decide({ ...base, permission: 'credential.export_totp' })).toEqual({
        allowed: false,
        reason: 'PERMISSION',
      });
    });
  });
});
