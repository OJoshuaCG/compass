import { describe, expect, it, vi } from 'vitest';

import type { AuditLog } from '../modules/audit/index.js';
import type { RevokeGrants } from '../modules/federation/index.js';
import type { SessionRepository } from '../modules/identity/index.js';
import { asUserId } from '../shared/kernel/index.js';
import type { RequestContextReader } from '../shared/kernel/index.js';
import { GrantRevokingSessionRepository } from './grant-revoking-session-repository.js';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const USER = asUserId('0195f0a0-0000-7000-8000-000000000001');
const SESSION = '0195f0a0-0000-7000-8000-0000000000aa';

function build(counts: { sessions?: number; others?: number; all?: number } = {}) {
  const inner = {
    revoke: vi.fn(() => Promise.resolve()),
    revokeOfUser: vi.fn(() => Promise.resolve(true)),
    revokeOthersOfUser: vi.fn(() => Promise.resolve()),
    revokeAllOfUser: vi.fn(() => Promise.resolve()),
  };
  const grants = {
    forSessions: vi.fn(() => Promise.resolve(counts.sessions ?? 0)),
    forUserExceptSession: vi.fn(() => Promise.resolve(counts.others ?? 0)),
    forUser: vi.fn(() => Promise.resolve(counts.all ?? 0)),
  };
  const record = vi.fn(() => Promise.resolve());
  const repository = new GrantRevokingSessionRepository({
    inner: inner as unknown as SessionRepository,
    grants: grants as unknown as RevokeGrants,
    audit: { record } as unknown as AuditLog,
    context: {
      current: () => ({ actorId: USER, requestId: 'req-1' }),
    } as unknown as RequestContextReader,
  });
  return { repository, inner, grants, record };
}

describe('GrantRevokingSessionRepository', () => {
  it('revocar una sesión borra sus concesiones y lo audita con el conteo', async () => {
    const { repository, inner, grants, record } = build({ sessions: 3 });
    await repository.revoke(SESSION, NOW);
    expect(inner.revoke).toHaveBeenCalledWith(SESSION, NOW);
    expect(grants.forSessions).toHaveBeenCalledWith([SESSION]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oidc.grants_revoked',
        targetType: 'session',
        targetId: SESSION,
        metadata: { reason: 'session_closed', count: 3 },
      }),
    );
  });

  it('sin concesiones borradas no escribe auditoría', async () => {
    const { repository, record } = build();
    await repository.revoke(SESSION, NOW);
    expect(record).not.toHaveBeenCalled();
  });

  it('una sesión que no era de la persona no toca concesiones', async () => {
    const { repository, inner, grants } = build({ sessions: 1 });
    inner.revokeOfUser.mockResolvedValueOnce(false);
    expect(await repository.revokeOfUser(SESSION, USER, NOW)).toBe(false);
    expect(grants.forSessions).not.toHaveBeenCalled();
  });

  it('cerrar las demás sesiones conserva las concesiones de la actual', async () => {
    const { repository, grants, record } = build({ others: 2 });
    await repository.revokeOthersOfUser(USER, SESSION, NOW);
    expect(grants.forUserExceptSession).toHaveBeenCalledWith(USER, SESSION);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'user',
        metadata: { reason: 'other_sessions_closed', count: 2 },
      }),
    );
  });

  it('revocar todas las sesiones de la persona borra todas sus concesiones, con o sin sesión viva', async () => {
    const { repository, grants, record } = build({ all: 4 });
    await repository.revokeAllOfUser(USER, NOW);
    expect(grants.forUser).toHaveBeenCalledWith(USER);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: 'all_user_sessions_closed', count: 4 } }),
    );
  });
});
