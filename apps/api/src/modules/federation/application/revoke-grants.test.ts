import { describe, expect, it, vi } from 'vitest';

import { RevokeGrants } from './revoke-grants.js';

describe('RevokeGrants', () => {
  it('no toca la base si no hay sesiones', async () => {
    const store = { deleteBySessions: vi.fn(), deleteByUser: vi.fn() };
    expect(await new RevokeGrants(store).forSessions([])).toBe(0);
    expect(store.deleteBySessions).not.toHaveBeenCalled();
  });

  it('delega el borrado por sesiones y por persona', async () => {
    const store = {
      deleteBySessions: vi.fn(() => Promise.resolve(3)),
      deleteByUser: vi.fn(() => Promise.resolve(5)),
    };
    const revoke = new RevokeGrants(store);
    expect(await revoke.forSessions(['s1', 's2'])).toBe(3);
    expect(store.deleteBySessions).toHaveBeenCalledWith(['s1', 's2']);
    expect(await revoke.forUser('u1')).toBe(5);
    expect(store.deleteByUser).toHaveBeenCalledWith('u1');
  });
});
