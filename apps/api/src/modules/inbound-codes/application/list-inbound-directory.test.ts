import { MAX_INBOUND_LISTING } from '@iam/contracts';
import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import { ListInboundDirectory } from './list-inbound-directory.js';
import type {
  ConfigurableSourceSummary,
  ConfigurableViewSummary,
  ReadableViewSummary,
  TemplateSummary,
} from './ports/inbound-directory.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');

const VIEW: ReadableViewSummary = {
  id: '0198bbbb-0000-7000-8000-000000000001',
  name: 'Soporte',
  sourceId: '0198bbbb-0000-7000-8000-000000000002',
  sourceDisplayName: 'Buzón de soporte',
  channel: 'mail',
  level: 'USE',
};

const SOURCE: ConfigurableSourceSummary = {
  id: '0198bbbb-0000-7000-8000-000000000002',
  channel: 'mail',
  address: 'codes@example.test',
  displayName: 'Buzón de soporte',
  accountId: null,
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  level: 'MANAGE',
};

const CONFIGURABLE_VIEW: ConfigurableViewSummary = {
  id: '0198bbbb-0000-7000-8000-000000000001',
  sourceId: '0198bbbb-0000-7000-8000-000000000002',
  name: 'Soporte',
  templateIds: ['0198cccc-0000-7000-8000-000000000001'],
  createdAt: new Date('2026-11-01T00:00:00Z'),
  level: 'EDIT',
};

const TEMPLATE: TemplateSummary = {
  id: '0198cccc-0000-7000-8000-000000000001',
  name: 'GitHub: código de acceso',
  kind: 'login_code',
};

interface HarnessOptions {
  readonly permissionRejection?: DomainError;
  readonly actorId?: UserId | null;
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const listReadableViews = vi.fn(() => Promise.resolve([VIEW]));
  const listConfigurableSources = vi.fn(() => Promise.resolve([SOURCE]));
  const listConfigurableViews = vi.fn(() => Promise.resolve([CONFIGURABLE_VIEW]));
  const listLiveTemplates = vi.fn(() => Promise.resolve([TEMPLATE]));
  const useCase = new ListInboundDirectory({
    context: {
      current: () => ({
        organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
        actorId: options.actorId === undefined ? ACTOR_ID : options.actorId,
        requestId: 'req-1',
        sessionId: null,
        reauthAt: null,
      }),
    },
    uow: {
      run: <T>(fn: () => Promise<T>) => fn(),
      runIndependent: <T>(fn: () => Promise<T>) => fn(),
    },
    authorizer: { require } as unknown as Authorizer,
    directory: {
      listReadableViews,
      listConfigurableSources,
      listConfigurableViews,
      listLiveTemplates,
    },
  });
  return {
    useCase,
    require,
    listReadableViews,
    listConfigurableSources,
    listConfigurableViews,
    listLiveTemplates,
  };
}

describe('ListInboundDirectory.listViews', () => {
  it('requires inbound.read_codes and lists the actor views with the listing cap', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.listViews();

    expect(result).toEqual({ ok: true, value: [VIEW] });
    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.read_codes' });
    expect(harness.listReadableViews).toHaveBeenCalledWith(ACTOR_ID, MAX_INBOUND_LISTING);
    expect(harness.listConfigurableSources).not.toHaveBeenCalled();
  });

  it('does not read the directory when the permission is denied', async () => {
    const denial = new DomainError('AUTHZ.PERMISSION', 'denied');
    const harness = buildHarness({ permissionRejection: denial });

    await expect(harness.useCase.listViews()).rejects.toBe(denial);
    expect(harness.listReadableViews).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated actor', async () => {
    const harness = buildHarness({ actorId: null });

    await expect(harness.useCase.listViews()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(harness.listReadableViews).not.toHaveBeenCalled();
  });
});

describe('ListInboundDirectory.listSources', () => {
  it('requires inbound.configure and lists the actor sources with the listing cap', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.listSources();

    expect(result).toEqual({ ok: true, value: [SOURCE] });
    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.configure' });
    expect(harness.listConfigurableSources).toHaveBeenCalledWith(ACTOR_ID, MAX_INBOUND_LISTING);
    expect(harness.listReadableViews).not.toHaveBeenCalled();
  });

  it('does not read the directory when the permission is denied', async () => {
    const denial = new DomainError('AUTHZ.PERMISSION', 'denied');
    const harness = buildHarness({ permissionRejection: denial });

    await expect(harness.useCase.listSources()).rejects.toBe(denial);
    expect(harness.listConfigurableSources).not.toHaveBeenCalled();
  });
});

describe('ListInboundDirectory.listConfigurableViews', () => {
  it('requires inbound.configure and lists the actor views with the listing cap', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.listConfigurableViews();

    expect(result).toEqual({ ok: true, value: [CONFIGURABLE_VIEW] });
    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.configure' });
    expect(harness.listConfigurableViews).toHaveBeenCalledWith(ACTOR_ID, MAX_INBOUND_LISTING);
    expect(harness.listReadableViews).not.toHaveBeenCalled();
  });

  it('does not read the directory when the permission is denied', async () => {
    const denial = new DomainError('AUTHZ.PERMISSION', 'denied');
    const harness = buildHarness({ permissionRejection: denial });

    await expect(harness.useCase.listConfigurableViews()).rejects.toBe(denial);
    expect(harness.listConfigurableViews).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated actor', async () => {
    const harness = buildHarness({ actorId: null });

    await expect(harness.useCase.listConfigurableViews()).rejects.toMatchObject({
      code: 'AUTHZ.SESSION',
    });
    expect(harness.listConfigurableViews).not.toHaveBeenCalled();
  });
});

describe('ListInboundDirectory.listTemplates', () => {
  it('requires inbound.configure and lists the live templates with the listing cap', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.listTemplates();

    expect(result).toEqual({ ok: true, value: [TEMPLATE] });
    expect(harness.require).toHaveBeenCalledWith({ permission: 'inbound.configure' });
    expect(harness.listLiveTemplates).toHaveBeenCalledWith(MAX_INBOUND_LISTING);
  });

  it('does not read the catalog when the permission is denied', async () => {
    const denial = new DomainError('AUTHZ.PERMISSION', 'denied');
    const harness = buildHarness({ permissionRejection: denial });

    await expect(harness.useCase.listTemplates()).rejects.toBe(denial);
    expect(harness.listLiveTemplates).not.toHaveBeenCalled();
  });

  it('rejects a request without an authenticated actor', async () => {
    const harness = buildHarness({ actorId: null });

    await expect(harness.useCase.listTemplates()).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(harness.listLiveTemplates).not.toHaveBeenCalled();
  });
});
