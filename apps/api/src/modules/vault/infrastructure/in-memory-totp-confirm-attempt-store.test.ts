import { describe, expect, it } from 'vitest';

import { InMemoryTotpConfirmAttemptStore } from './in-memory-totp-confirm-attempt-store.js';

describe('InMemoryTotpConfirmAttemptStore', () => {
  it('counts failures per registration key and clears them', async () => {
    const store = new InMemoryTotpConfirmAttemptStore();

    await store.recordFailure('credential-a:1');
    await store.recordFailure('credential-a:1');
    await store.recordFailure('credential-a:2');

    expect(await store.failures('credential-a:1')).toBe(2);
    expect(await store.failures('credential-a:2')).toBe(1);
    expect(await store.failures('credential-b:1')).toBe(0);

    await store.clear('credential-a:1');
    expect(await store.failures('credential-a:1')).toBe(0);
    expect(await store.failures('credential-a:2')).toBe(1);
  });
});
