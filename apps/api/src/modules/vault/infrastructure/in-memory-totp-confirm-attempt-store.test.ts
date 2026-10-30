import { describe, expect, it } from 'vitest';

import { INITIAL_TOTP_CONFIRM_LOCK_STATE } from '../domain/totp-confirm-lock.js';
import { InMemoryTotpConfirmAttemptStore } from './in-memory-totp-confirm-attempt-store.js';

const LOCKED_UNTIL = new Date('2026-03-04T16:05:00.000Z');

// SENSIBLE (revisión humana)
describe('InMemoryTotpConfirmAttemptStore', () => {
  it('returns the zero state for a registration that never failed', async () => {
    const store = new InMemoryTotpConfirmAttemptStore();

    expect(await store.state('credential-a:1')).toEqual(INITIAL_TOTP_CONFIRM_LOCK_STATE);
  });

  it('keeps the state per registration key and clears one key without touching the others', async () => {
    const store = new InMemoryTotpConfirmAttemptStore();
    const lockedState = { failures: 0, lockCount: 2, lockedUntil: LOCKED_UNTIL };

    await store.save('credential-a:1', { failures: 3, lockCount: 0, lockedUntil: null });
    await store.save('credential-a:2', lockedState);

    expect(await store.state('credential-a:1')).toEqual({
      failures: 3,
      lockCount: 0,
      lockedUntil: null,
    });
    expect(await store.state('credential-a:2')).toEqual(lockedState);
    expect(await store.state('credential-b:1')).toEqual(INITIAL_TOTP_CONFIRM_LOCK_STATE);

    await store.clear('credential-a:1');
    expect(await store.state('credential-a:1')).toEqual(INITIAL_TOTP_CONFIRM_LOCK_STATE);
    expect(await store.state('credential-a:2')).toEqual(lockedState);
  });

  it('clear forgets the escalation level and the lock, not only the failures', async () => {
    const store = new InMemoryTotpConfirmAttemptStore();
    await store.save('credential-a:1', { failures: 0, lockCount: 3, lockedUntil: LOCKED_UNTIL });

    await store.clear('credential-a:1');

    expect(await store.state('credential-a:1')).toEqual(INITIAL_TOTP_CONFIRM_LOCK_STATE);
  });

  it('overwrites the previous state of the same key on save', async () => {
    const store = new InMemoryTotpConfirmAttemptStore();
    await store.save('credential-a:1', { failures: 1, lockCount: 0, lockedUntil: null });
    await store.save('credential-a:1', { failures: 2, lockCount: 0, lockedUntil: null });

    expect((await store.state('credential-a:1')).failures).toBe(2);
  });
});
