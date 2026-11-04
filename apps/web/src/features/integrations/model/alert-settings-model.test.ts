import { describe, expect, it } from 'vitest';

import { hasActiveChannel } from './alert-settings-model';

describe('hasActiveChannel', () => {
  it('accepts any combination with at least one channel on', () => {
    expect(hasActiveChannel({ email: true, telegram: true })).toBe(true);
    expect(hasActiveChannel({ email: true, telegram: false })).toBe(true);
    expect(hasActiveChannel({ email: false, telegram: true })).toBe(true);
  });

  it('rejects both channels off', () => {
    expect(hasActiveChannel({ email: false, telegram: false })).toBe(false);
  });
});
