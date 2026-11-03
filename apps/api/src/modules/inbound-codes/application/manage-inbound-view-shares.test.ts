import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import { ManageInboundViewShares } from './manage-inbound-view-shares.js';
import type {
  InboundViewShareRepository,
  ViewShareRecord,
  ViewShareView,
} from './ports/inbound-view-share-repository.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const GRANTEE_ID = '0198aaaa-0000-7000-8000-000000000002';
const VIEW_ID = '0198bbbb-0000-7000-8000-000000000001';
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000002';
const ACCOUNT_ID = '0198bbbb-0000-7000-8000-000000000003';
const SHARE_ID = '0198cccc-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-02T12:00:00Z');

type Level = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE' | null;

interface HarnessOptions {
  readonly viewLevel?: Level;
  readonly viewExists?: boolean;
  readonly accountId?: string | null;
  readonly accountLevel?: Level;
  readonly granteeActive?: boolean;
  readonly open?: ViewShareRecord | null;
  readonly permissionRejection?: DomainError;
}

const createdShare: ViewShareView = {
  id: SHARE_ID,
  viewId: VIEW_ID,
  granteeType: 'user',
  granteeId: GRANTEE_ID,
  granteeName: 'Grantee',
  level: 'USE',
  expiresAt: null,
  grantedBy: ACTOR_ID,
  createdAt: NOW,
};

function openShare(expiresAt: Date | null): ViewShareRecord {
  return {
    id: SHARE_ID,
    viewId: VIEW_ID,
    granteeType: 'user',
    granteeId: GRANTEE_ID,
    level: 'USE',
    expiresAt,
    grantedBy: ACTOR_ID,
    createdAt: NOW,
  };
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) => Promise.resolve(ok(event as never)));
  const insert = vi.fn(() => Promise.resolve());
  const revoke = vi.fn(() => Promise.resolve());
  const view =
    options.viewExists === false
      ? null
      : {
          id: VIEW_ID,
          sourceId: SOURCE_ID,
          accountId: options.accountId === undefined ? null : options.accountId,
        };
  const shares: InboundViewShareRepository = {
    findView: () => Promise.resolve(view),
    findViewForUpdate: () => Promise.resolve(view),
    viewLevel: () =>
      Promise.resolve(options.viewLevel === undefined ? 'MANAGE' : options.viewLevel),
    lockAccountForShare: () => Promise.resolve(),
    accountLevel: () =>
      Promise.resolve(options.accountLevel === undefined ? null : options.accountLevel),
    listLive: () => Promise.resolve([createdShare]),
    findViewShareById: () => Promise.resolve(createdShare),
    findOpenByGrantee: () => Promise.resolve(options.open === undefined ? null : options.open),
    findOpenById: () => Promise.resolve(options.open === undefined ? null : options.open),
    insert,
    revoke,
    userIsActive: () => Promise.resolve(options.granteeActive !== false),
    groupIsLive: () => Promise.resolve(true),
  };
  const useCase = new ManageInboundViewShares({
    context: {
      current: () => ({
        organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
        actorId: ACTOR_ID,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: null,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require, auditDenial } as unknown as Authorizer,
    shares,
    ids: { next: () => SHARE_ID },
    audit: { record: auditRecord },
    clock: { now: () => NOW },
  });
  return { useCase, require, auditDenial, auditRecord, insert, revoke };
}

const shareInput = { granteeType: 'user', granteeId: GRANTEE_ID, level: 'USE' } as const;

describe('ManageInboundViewShares.share', () => {
  it('comparte con MANAGE sobre la vista y audita inbound.view_shared al final', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.share(VIEW_ID, shareInput);

    expect(result.ok).toBe(true);
    expect(harness.insert).toHaveBeenCalledTimes(1);
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.view_shared',
        targetType: 'mail_view',
        targetId: VIEW_ID,
        metadata: { level: 'USE', granteeType: 'user', granteeId: GRANTEE_ID, expiresAt: null },
      }),
    );
  });

  it.each<Level>(['USE', 'VIEW', 'EDIT'])(
    'con nivel %s sobre la vista se niega y se audita',
    async (level) => {
      const harness = buildHarness({ viewLevel: level });

      const result = await harness.useCase.share(VIEW_ID, shareInput);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
      expect(harness.auditDenial).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'share.manage', targetViewId: VIEW_ID }),
      );
      expect(harness.insert).not.toHaveBeenCalled();
      expect(harness.auditRecord).not.toHaveBeenCalled();
    },
  );

  it('sin nivel sobre la vista responde NOT_FOUND y audita el intento', async () => {
    const harness = buildHarness({ viewLevel: null });

    const result = await harness.useCase.share(VIEW_ID, shareInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(harness.auditDenial).toHaveBeenCalledTimes(1);
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it('una vista inexistente o archivada responde NOT_FOUND y audita', async () => {
    const harness = buildHarness({ viewExists: false });

    const result = await harness.useCase.share(VIEW_ID, shareInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(harness.auditDenial).toHaveBeenCalledTimes(1);
  });

  it('el permiso share.manage se pide antes de mirar la vista', async () => {
    const rejection = new DomainError('AUTHZ.PERMISSION', 'Missing permission');
    const harness = buildHarness({ permissionRejection: rejection });

    await expect(harness.useCase.share(VIEW_ID, shareInput)).rejects.toBe(rejection);
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it('con fuente ligada a una cuenta pide al menos USE sobre ella', async () => {
    const withoutAccount = buildHarness({ accountId: ACCOUNT_ID, accountLevel: null });
    const denied = await withoutAccount.useCase.share(VIEW_ID, shareInput);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('AUTHZ.SHARE');
    expect(withoutAccount.insert).not.toHaveBeenCalled();
    expect(withoutAccount.auditDenial).toHaveBeenCalledTimes(1);

    const withUse = buildHarness({ accountId: ACCOUNT_ID, accountLevel: 'USE' });
    const allowed = await withUse.useCase.share(VIEW_ID, shareInput);
    expect(allowed.ok).toBe(true);
  });

  it('rechaza una caducidad pasada o a más de un año', async () => {
    const harness = buildHarness();
    const past = await harness.useCase.share(VIEW_ID, {
      ...shareInput,
      expiresAt: '2026-11-01T00:00:00.000Z',
    });
    const tooFar = await harness.useCase.share(VIEW_ID, {
      ...shareInput,
      expiresAt: '2028-01-01T00:00:00.000Z',
    });

    for (const result of [past, tooFar]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SHARE.EXPIRY_INVALID');
    }
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it('rechaza compartirse a uno mismo y destinatarios inactivos', async () => {
    const self = await buildHarness().useCase.share(VIEW_ID, {
      ...shareInput,
      granteeId: ACTOR_ID,
    });
    const inactive = await buildHarness({ granteeActive: false }).useCase.share(
      VIEW_ID,
      shareInput,
    );

    for (const result of [self, inactive]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('SHARE.GRANTEE_INVALID');
    }
  });

  it('un acceso vigente del mismo destinatario da SHARE.ALREADY_EXISTS', async () => {
    const harness = buildHarness({ open: openShare(null) });

    const result = await harness.useCase.share(VIEW_ID, shareInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SHARE.ALREADY_EXISTS');
    expect(harness.insert).not.toHaveBeenCalled();
  });

  it('una compartición vencida se cierra y se vuelve a compartir', async () => {
    const harness = buildHarness({ open: openShare(new Date('2026-11-01T00:00:00Z')) });

    const result = await harness.useCase.share(VIEW_ID, shareInput);

    expect(result.ok).toBe(true);
    expect(harness.revoke).toHaveBeenCalledTimes(1);
    expect(harness.insert).toHaveBeenCalledTimes(1);
  });
});

describe('ManageInboundViewShares.revoke', () => {
  it('revoca y audita inbound.view_share_revoked con rotationTasks 0', async () => {
    const harness = buildHarness({ open: openShare(null) });

    const result = await harness.useCase.revoke(VIEW_ID, SHARE_ID);

    expect(result.ok).toBe(true);
    expect(harness.revoke).toHaveBeenCalledWith(SHARE_ID, NOW, ACTOR_ID);
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.view_share_revoked',
        metadata: { level: 'USE', granteeType: 'user', granteeId: GRANTEE_ID, rotationTasks: 0 },
      }),
    );
  });

  it.each<Level>(['USE', 'VIEW', 'EDIT'])('con nivel %s no revoca', async (level) => {
    const harness = buildHarness({ viewLevel: level, open: openShare(null) });

    const result = await harness.useCase.revoke(VIEW_ID, SHARE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTHZ.SHARE');
    expect(harness.revoke).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('una compartición inexistente responde NOT_FOUND', async () => {
    const harness = buildHarness({ open: null });

    const result = await harness.useCase.revoke(VIEW_ID, SHARE_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('ManageInboundViewShares.list', () => {
  it('lista solo con MANAGE sobre la vista', async () => {
    const allowed = await buildHarness().useCase.list(VIEW_ID);
    expect(allowed.ok).toBe(true);

    const denied = await buildHarness({ viewLevel: 'EDIT' }).useCase.list(VIEW_ID);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('AUTHZ.SHARE');
  });
});
