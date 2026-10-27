import { PERMISSIONS } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import { groupPermissions } from './permission-groups';

describe('groupPermissions', () => {
  it('groups by area in catalog order, regardless of the input order', () => {
    expect(groupPermissions(['user.update', 'role.manage', 'user.invite'])).toEqual([
      { id: 'role', permissions: ['role.manage'] },
      { id: 'user', permissions: ['user.invite', 'user.update'] },
    ]);
  });

  it('uses the whole prefix before the first dot, even with underscores', () => {
    expect(groupPermissions(['access_request.approve', 'sso.clients.manage'])).toEqual([
      { id: 'sso', permissions: ['sso.clients.manage'] },
      { id: 'access_request', permissions: ['access_request.approve'] },
    ]);
  });

  it('ignores unknown permissions and returns nothing for an empty list', () => {
    expect(groupPermissions(['nope.nothing'])).toEqual([]);
    expect(groupPermissions([])).toEqual([]);
  });

  it('keeps every catalog permission exactly once', () => {
    const flat = groupPermissions(PERMISSIONS).flatMap((group) => group.permissions);
    expect([...flat].sort()).toEqual([...PERMISSIONS].sort());
  });
});
