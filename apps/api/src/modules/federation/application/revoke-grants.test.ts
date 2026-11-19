import { describe, expect, it, vi } from 'vitest';

import type { BackchannelLogoutTarget } from '../domain/backchannel-logout.js';
import { RevokeGrants } from './revoke-grants.js';

const TARGET: BackchannelLogoutTarget = { clientId: 'app-1', sid: 'sid-1' };

function build(deleted = { sessions: 3, user: 5, userExcept: 2 }) {
  const calls: string[] = [];
  const store = {
    findLogoutTargetsBySessions: vi.fn(() => {
      calls.push('find');
      return Promise.resolve([TARGET]);
    }),
    findLogoutTargetsByUser: vi.fn(() => Promise.resolve([TARGET])),
    findLogoutTargetsByUserExceptSession: vi.fn(() => Promise.resolve([TARGET])),
    deleteBySessions: vi.fn(() => {
      calls.push('delete');
      return Promise.resolve(deleted.sessions);
    }),
    deleteByUser: vi.fn(() => Promise.resolve(deleted.user)),
    deleteByUserExceptSession: vi.fn(() => Promise.resolve(deleted.userExcept)),
  };
  const queue = {
    enqueue: vi.fn((target: BackchannelLogoutTarget) => {
      calls.push(`enqueue:${target.clientId}`);
      return Promise.resolve();
    }),
  };
  return { store, queue, calls, revoke: new RevokeGrants(store, queue) };
}

describe('RevokeGrants', () => {
  it('no toca la base si no hay sesiones', async () => {
    const { store, queue, revoke } = build();
    expect(await revoke.forSessions([])).toBe(0);
    expect(store.deleteBySessions).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('delega el borrado por sesiones y por persona', async () => {
    const { store, revoke } = build();
    expect(await revoke.forSessions(['s1', 's2'])).toBe(3);
    expect(store.deleteBySessions).toHaveBeenCalledWith(['s1', 's2']);
    expect(await revoke.forUser('u1')).toBe(5);
    expect(store.deleteByUser).toHaveBeenCalledWith('u1');
    expect(await revoke.forUserExceptSession('u1', 's9')).toBe(2);
    expect(store.deleteByUserExceptSession).toHaveBeenCalledWith('u1', 's9');
  });

  it('lee y encola los avisos de logout ANTES de borrar las concesiones', async () => {
    const { calls, queue, revoke } = build();
    await revoke.forSessions(['s1']);
    expect(calls).toEqual(['find', 'enqueue:app-1', 'delete']);
    expect(queue.enqueue).toHaveBeenCalledWith(TARGET);
  });

  it('avisa también al revocar por persona y por «las otras sesiones»', async () => {
    const { queue, revoke } = build();
    await revoke.forUser('u1');
    await revoke.forUserExceptSession('u1', 's9');
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
});
