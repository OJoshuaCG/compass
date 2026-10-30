import type { ShareLevel } from '@iam/contracts';
import { describe, expect, it } from 'vitest';

import {
  canChangePassword,
  canCopyUsername,
  canCreateCredential,
  canRestoreVersion,
  canRevealPassword,
  canViewHistory,
} from './credential-access';
import { isRevealReasonValid, revealReasonLength } from './secret-policy';

const LEVELS: (ShareLevel | null)[] = [null, 'USE', 'VIEW', 'EDIT', 'MANAGE'];
const gates = (check: (level: ShareLevel | null) => boolean) => LEVELS.map(check);

describe('credential access gating', () => {
  it('copy username needs USE or more and no permission', () => {
    expect(gates(canCopyUsername)).toEqual([false, true, true, true, true]);
  });

  it('reveal needs VIEW or more AND the permission', () => {
    expect(gates((level) => canRevealPassword(true, level))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(gates((level) => canRevealPassword(false, level))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('create, change password and restore a version need EDIT or more AND their own permission', () => {
    for (const check of [canCreateCredential, canChangePassword, canRestoreVersion]) {
      expect(gates((level) => check(true, level))).toEqual([false, false, false, true, true]);
      expect(gates((level) => check(false, level))).toEqual([false, false, false, false, false]);
    }
  });

  it('history needs EDIT or more and no permission', () => {
    expect(gates(canViewHistory)).toEqual([false, false, false, true, true]);
  });
});

describe('reveal reason', () => {
  it('counts without the surrounding spaces, like the server', () => {
    expect(revealReasonLength('  abc  ')).toBe(3);
  });

  it('accepts 6 to 500 characters and rejects the rest', () => {
    expect(isRevealReasonValid('12345')).toBe(false);
    expect(isRevealReasonValid('123456')).toBe(true);
    expect(isRevealReasonValid('x'.repeat(500))).toBe(true);
    expect(isRevealReasonValid('x'.repeat(501))).toBe(false);
    expect(isRevealReasonValid('      ')).toBe(false);
  });
});
