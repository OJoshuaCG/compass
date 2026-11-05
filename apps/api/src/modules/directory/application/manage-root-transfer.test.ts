/**
 * SENSIBLE (ruta protegida: identidad, acceso y auditoría). Esta prueba la debe revisar una persona.
 *
 * Recorre la transferencia de la Raíz con dobles en memoria y la auditoría real (lista blanca incluida):
 * propuesta, aceptación con reautenticación, plazos de 7 días y 72 horas, cancelación, y el cierre que
 * intercambia rangos, retira el acceso anterior y anula los códigos de emergencia.
 */
import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { Rank, UserId } from '../../../shared/kernel/index.js';
import { RecordAuditEvent } from '../../audit/application/record-audit-event.js';
import { InMemoryAuditEventRepository } from '../../audit/testing/in-memory-audit-event-repository.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { RootTransferNoticePayload } from '../domain/root-transfer-notice.js';
import type { RootTransferRecord } from '../domain/root-transfer.js';
import type { UserRecord } from '../domain/user.js';
import { InMemoryUserDirectory } from '../testing/in-memory-user-directory.js';
import { CompleteRootTransfers } from './complete-root-transfers.js';
import { ManageRootTransfer } from './manage-root-transfer.js';
import type { RootTransferClosing } from './ports/root-transfer-store.js';
import { RootTransferFinalizer } from './root-transfer-finalizer.js';

const ORGANIZATION_ID = asOrganizationId('org-1');
const START = new Date('2026-11-04T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const REAUTH_WINDOW_MS = 5 * 60 * 1000;

const ROOT_ID = asUserId('root');
const ADMIN_ID = asUserId('admin');
const OTHER_ADMIN_ID = asUserId('other-admin');
const LEADER_ID = asUserId('leader');

const person = (
  id: UserId,
  rank: Rank,
  managedBy: UserId | null,
  status: UserRecord['status'] = 'active',
): UserRecord => ({
  id,
  organizationId: ORGANIZATION_ID,
  email: `${id}@example.test`,
  displayName: id,
  rank,
  status,
  managedBy,
  createdBy: managedBy,
  locale: 'es-MX',
  timezone: 'America/Mexico_City',
});

class InMemoryRootTransferStore {
  open: RootTransferRecord | null = null;
  closings: RootTransferClosing[] = [];
  findOpenForUpdate(): Promise<RootTransferRecord | null> {
    return Promise.resolve(this.open);
  }
  insert(input: {
    fromUserId: UserId;
    toUserId: UserId;
    requestedAt: Date;
    expiresAt: Date;
  }): Promise<RootTransferRecord> {
    this.open = {
      id: 'transfer-1',
      ...input,
      status: 'pending_acceptance',
      acceptedAt: null,
      executesAt: null,
    };
    return Promise.resolve(this.open);
  }
  markAccepted(_id: string, acceptedAt: Date, executesAt: Date): Promise<void> {
    if (this.open !== null) this.open = { ...this.open, status: 'waiting', acceptedAt, executesAt };
    return Promise.resolve();
  }
  close(_id: string, closing: RootTransferClosing): Promise<void> {
    this.closings.push(closing);
    this.open = null;
    return Promise.resolve();
  }
}

interface SetupOptions {
  readonly users?: readonly UserRecord[];
}

function setup(options: SetupOptions = {}) {
  let now = START;
  let actorId: UserId = ROOT_ID;
  let reauthAt: Date | null = START;
  const directory = new InMemoryUserDirectory();
  for (const user of options.users ?? [
    person(ROOT_ID, 0, null),
    person(ADMIN_ID, 1, ROOT_ID),
    person(OTHER_ADMIN_ID, 1, ROOT_ID),
    person(LEADER_ID, 2, ADMIN_ID),
  ]) {
    directory.add(user);
  }
  const context = () => ({
    organizationId: ORGANIZATION_ID,
    actorId,
    requestId: 'request-1',
    sessionId: null,
    reauthAt,
  });
  const auditRepository = new InMemoryAuditEventRepository();
  let nextId = 0;
  const audit = new RecordAuditEvent({
    repository: auditRepository,
    context: { current: context },
    ids: { next: () => `audit-${String((nextId += 1))}` },
  });
  const store = new InMemoryRootTransferStore();
  const notices: RootTransferNoticePayload[] = [];
  const calls: string[] = [];
  const auditDenial = vi.fn(() => Promise.resolve());
  // `org.settings` solo lo tiene la Raíz: este doble reproduce esa decisión del motor.
  const require = vi.fn(() =>
    actorId === ROOT_ID
      ? Promise.resolve(undefined)
      : Promise.reject(new Error('AUTHZ.PERMISSION')),
  );
  const finalizer = new RootTransferFinalizer({
    context: { current: context },
    directory,
    swap: {
      swapRoot: async ({ fromUserId, toUserId }) => {
        calls.push('swap');
        await directory.setRank(fromUserId, 1);
        await directory.setManager(fromUserId, toUserId);
        await directory.setRank(toUserId, 0);
        return directory.reassignReports(fromUserId, toUserId);
      },
    },
    roles: {
      promote: () => {
        calls.push('promote');
        return Promise.resolve();
      },
      demote: () => {
        calls.push('demote');
        return Promise.resolve();
      },
    },
    access: {
      revokeForReenrollment: () => {
        calls.push('revoke-access');
        return Promise.resolve();
      },
    },
    emergencyCodes: {
      invalidateAll: () => {
        calls.push('invalidate-codes');
        return Promise.resolve(4);
      },
    },
    store,
    notices: {
      enqueue: (notice) => {
        notices.push(notice);
        return Promise.resolve();
      },
    },
    audit,
    clock: { now: () => now },
  });
  const uow: UnitOfWork = { run: (fn) => fn(), runIndependent: (fn) => fn() };
  const manage = new ManageRootTransfer({
    context: { current: context },
    uow,
    authorizer: {
      require,
      auditDenial,
      actorPermissions: () => Promise.resolve(new Set()),
      requireActiveMember: async () => {
        const actor = await directory.findById(actorId);
        if (actor === null) throw new Error('missing actor');
        return actor;
      },
    },
    directory,
    store,
    finalizer,
    clock: { now: () => now },
    reauthWindowMs: REAUTH_WINDOW_MS,
  });
  const job = new CompleteRootTransfers({ uow, directory, store, finalizer });
  return {
    manage,
    job,
    store,
    notices,
    calls,
    auditDenial,
    directory,
    audit: auditRepository,
    actAs: (id: UserId) => {
      actorId = id;
    },
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
    setReauth: (value: Date | null) => {
      reauthAt = value;
    },
    now: () => now,
  };
}

const auditedActions = (repository: InMemoryAuditEventRepository): string[] =>
  repository.events.map((event) => event.action);

describe('proposing a root transfer', () => {
  it('opens a pending proposal that expires in 7 days, notifies and audits', async () => {
    const t = setup();
    const outcome = await t.manage.propose(ADMIN_ID);
    expect(outcome.ok).toBe(true);
    expect(t.store.open).toMatchObject({
      status: 'pending_acceptance',
      toUserId: ADMIN_ID,
      fromUserId: ROOT_ID,
    });
    expect(t.store.open?.expiresAt.getTime()).toBe(START.getTime() + 7 * DAY);
    expect(t.notices.map((notice) => notice.kind)).toEqual(['requested']);
    expect(auditedActions(t.audit)).toEqual(['root_transfer.requested']);
  });

  it.each([
    ['a leader', LEADER_ID],
    ['the root itself', ROOT_ID],
    ['an unknown person', asUserId('ghost')],
  ])('refuses %s as target, audits the denial and opens nothing', async (_label, target) => {
    const t = setup();
    const outcome = await t.manage.propose(target);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'ROOT_TRANSFER.TARGET_NOT_ELIGIBLE' },
    });
    expect(t.auditDenial).toHaveBeenCalledTimes(1);
    expect(t.store.open).toBeNull();
  });

  it('refuses a suspended administrator', async () => {
    const t = setup({
      users: [person(ROOT_ID, 0, null), person(ADMIN_ID, 1, ROOT_ID, 'suspended')],
    });
    const outcome = await t.manage.propose(ADMIN_ID);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'ROOT_TRANSFER.TARGET_NOT_ELIGIBLE' },
    });
  });

  it('refuses a second proposal while one is open', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    const second = await t.manage.propose(OTHER_ADMIN_ID);
    expect(second).toMatchObject({ ok: false, error: { code: 'ROOT_TRANSFER.ALREADY_OPEN' } });
  });

  it('lets a new proposal replace one that already expired', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.advance(7 * DAY);
    const second = await t.manage.propose(OTHER_ADMIN_ID);
    expect(second.ok).toBe(true);
    expect(t.store.closings.map((closing) => closing.status)).toEqual(['expired']);
    expect(t.store.open?.toUserId).toBe(OTHER_ADMIN_ID);
  });

  it('is denied to anyone who is not the root (the engine decides)', async () => {
    const t = setup();
    t.actAs(ADMIN_ID);
    await expect(t.manage.propose(OTHER_ADMIN_ID)).rejects.toThrow('AUTHZ.PERMISSION');
    expect(t.store.open).toBeNull();
  });
});

describe('accepting a root transfer', () => {
  it('starts the 72 hours from the acceptance, not from the proposal', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.advance(2 * DAY);
    t.actAs(ADMIN_ID);
    t.setReauth(t.now());
    const outcome = await t.manage.accept();
    expect(outcome.ok).toBe(true);
    expect(t.store.open?.executesAt?.getTime()).toBe(t.now().getTime() + 72 * HOUR);
    expect(t.notices.map((notice) => notice.kind)).toEqual(['requested', 'accepted']);
    expect(auditedActions(t.audit)).toEqual(['root_transfer.requested', 'root_transfer.accepted']);
  });

  it('requires a fresh re-authentication and audits the denial', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.actAs(ADMIN_ID);
    t.setReauth(new Date(START.getTime() - REAUTH_WINDOW_MS - 1));
    const stale = await t.manage.accept();
    expect(stale).toMatchObject({ ok: false, error: { code: 'AUTHZ.REAUTH_REQUIRED' } });
    t.setReauth(null);
    const none = await t.manage.accept();
    expect(none).toMatchObject({ ok: false, error: { code: 'AUTHZ.REAUTH_REQUIRED' } });
    expect(t.auditDenial).toHaveBeenCalledTimes(2);
    expect(t.store.open?.status).toBe('pending_acceptance');
  });

  it('only the person it was proposed to can accept', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.actAs(OTHER_ADMIN_ID);
    const outcome = await t.manage.accept();
    expect(outcome).toMatchObject({ ok: false, error: { code: 'ROOT_TRANSFER.NOT_FOUND' } });
    expect(t.store.open?.status).toBe('pending_acceptance');
  });

  it('closes an expired proposal instead of accepting it', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.advance(7 * DAY);
    t.actAs(ADMIN_ID);
    t.setReauth(t.now());
    const outcome = await t.manage.accept();
    expect(outcome).toMatchObject({ ok: false, error: { code: 'ROOT_TRANSFER.EXPIRED' } });
    expect(t.store.closings.map((closing) => closing.status)).toEqual(['expired']);
    expect(t.notices.map((notice) => notice.kind)).toEqual(['requested', 'expired']);
  });
});

describe('cancelling a root transfer', () => {
  it.each([
    ['the root', ROOT_ID],
    ['the target', ADMIN_ID],
    ['another administrator', OTHER_ADMIN_ID],
  ])('lets %s cancel, notifies and audits', async (_label, canceller) => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.actAs(canceller);
    expect((await t.manage.cancel()).ok).toBe(true);
    expect(t.store.closings[0]).toMatchObject({
      status: 'cancelled',
      cancelledBy: canceller,
      cancelReason: 'manual',
    });
    expect(t.notices.map((notice) => notice.kind)).toEqual(['requested', 'cancelled']);
    expect(auditedActions(t.audit)).toContain('root_transfer.cancelled');
  });

  it('refuses a leader and audits the denial', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.actAs(LEADER_ID);
    expect(await t.manage.cancel()).toMatchObject({
      ok: false,
      error: { code: 'AUTHZ.PERMISSION' },
    });
    expect(t.auditDenial).toHaveBeenCalledTimes(1);
    expect(t.store.open).not.toBeNull();
  });

  it('says there is nothing to cancel when no transfer is open', async () => {
    const t = setup();
    expect(await t.manage.cancel()).toMatchObject({
      ok: false,
      error: { code: 'ROOT_TRANSFER.NOT_FOUND' },
    });
  });
});

describe('who can see the open transfer', () => {
  it('shows it to administrators and hides it from leaders', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.actAs(OTHER_ADMIN_ID);
    const seen = await t.manage.current();
    expect(seen.ok && seen.value?.toUserId).toBe(ADMIN_ID);
    t.actAs(LEADER_ID);
    expect(await t.manage.current()).toMatchObject({
      ok: false,
      error: { code: 'AUTHZ.PERMISSION' },
    });
  });
});

async function acceptedTransfer() {
  const t = setup();
  await t.manage.propose(ADMIN_ID);
  t.actAs(ADMIN_ID);
  t.setReauth(t.now());
  await t.manage.accept();
  return t;
}

describe('the periodic job that completes the transfer', () => {
  it('does nothing before the 72 hours elapse', async () => {
    const t = await acceptedTransfer();
    t.advance(72 * HOUR - 1);
    expect(await t.job.run()).toBe('not_due');
    expect(t.calls).toEqual([]);
    expect(t.store.open?.status).toBe('waiting');
  });

  it('does nothing when there is no open transfer', async () => {
    expect(await setup().job.run()).toBe('none');
  });

  it('swaps the ranks, hands the roles over, locks out the old root and voids the emergency codes', async () => {
    const t = await acceptedTransfer();
    t.advance(72 * HOUR);
    expect(await t.job.run()).toBe('completed');
    expect(t.calls).toEqual(['swap', 'promote', 'demote', 'revoke-access', 'invalidate-codes']);
    expect(await t.directory.findById(ADMIN_ID)).toMatchObject({ rank: 0 });
    expect(await t.directory.findById(ROOT_ID)).toMatchObject({
      rank: 1,
      managedBy: ADMIN_ID,
      status: 'invited',
    });
    expect(await t.directory.findById(OTHER_ADMIN_ID)).toMatchObject({ managedBy: ADMIN_ID });
    expect(t.store.closings.at(-1)?.status).toBe('completed');
    expect(t.notices.map((notice) => notice.kind)).toEqual(['requested', 'accepted', 'completed']);
    expect(auditedActions(t.audit).at(-1)).toBe('root_transfer.completed');
  });

  it('cancels by itself, with notice, when the target is no longer an active administrator', async () => {
    const t = await acceptedTransfer();
    await t.directory.setStatus(ADMIN_ID, 'suspended');
    t.advance(72 * HOUR);
    expect(await t.job.run()).toBe('cancelled');
    expect(t.calls).toEqual([]);
    expect(t.store.closings.at(-1)).toMatchObject({
      status: 'cancelled',
      cancelledBy: null,
      cancelReason: 'target_not_active_admin',
    });
    expect(await t.directory.findById(ROOT_ID)).toMatchObject({ rank: 0 });
    expect(t.notices.at(-1)?.kind).toBe('cancelled');
  });

  it('expires a proposal nobody accepted in 7 days', async () => {
    const t = setup();
    await t.manage.propose(ADMIN_ID);
    t.advance(7 * DAY);
    expect(await t.job.run()).toBe('expired');
    expect(t.notices.at(-1)?.kind).toBe('expired');
  });
});
