import { describe, expect, it } from 'vitest';

import { createReauthCoordinator } from './reauth-coordinator';

describe('reauth coordinator', () => {
  it('ignores a settle addressed to a previous request', async () => {
    const coordinator = createReauthCoordinator();
    const first = coordinator.request();
    const firstId = coordinator.currentId();
    coordinator.settle(false);
    await expect(first).resolves.toBe(false);

    const second = coordinator.request();
    coordinator.settle(true, firstId ?? -1);
    expect(coordinator.isOpen()).toBe(true);
    coordinator.settle(true, coordinator.currentId() ?? -1);
    await expect(second).resolves.toBe(true);
    expect(coordinator.isOpen()).toBe(false);
  });
});
