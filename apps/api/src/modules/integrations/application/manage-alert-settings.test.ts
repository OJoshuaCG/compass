import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../shared/kernel/index.js';
import type { OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { AlertSettingsRecord } from '../domain/alert-settings.js';
import { ManageAlertSettings } from './manage-alert-settings.js';
import type { ManageAlertSettingsDeps } from './manage-alert-settings.js';
import type { SaveAlertSettingsInput } from './ports/alert-settings-store.js';

// SENSIBLE (revisión humana): permiso del panel de alertas de la Raíz y regla de «al menos un canal».

const ORGANIZATION_ID = 'org-1' as OrganizationId;
const ACTOR_ID = 'user-1' as UserId;
const NOW = new Date('2026-11-04T10:00:00.000Z');

const DEFAULT_RECORD: AlertSettingsRecord = {
  infrastructure: { email: true, telegram: true },
  updatedBy: null,
  updatedAt: null,
  version: 0,
};

interface Options {
  readonly allowed?: boolean;
  readonly conflict?: boolean;
  readonly actorId?: UserId | null;
}

function buildHarness(options: Options = {}) {
  const require = vi.fn(() =>
    options.allowed === false
      ? Promise.reject(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'))
      : Promise.resolve([]),
  );
  const find = vi.fn(() => Promise.resolve(DEFAULT_RECORD));
  const save = vi.fn((input: SaveAlertSettingsInput) =>
    Promise.resolve(
      options.conflict === true
        ? null
        : {
            infrastructure: input.infrastructure,
            updatedBy: input.updatedBy,
            updatedAt: NOW,
            version: input.expectedVersion + 1,
          },
    ),
  );
  const record = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
  const deps = {
    context: {
      current: () => ({
        organizationId: ORGANIZATION_ID,
        actorId: options.actorId === undefined ? ACTOR_ID : options.actorId,
        requestId: 'req-1',
        reauthAt: NOW,
      }),
    },
    uow: { run: <T>(fn: () => Promise<T>) => fn() },
    authorizer: { require },
    settings: { find, save },
    audit: { record },
  } as unknown as ManageAlertSettingsDeps;
  return { useCase: new ManageAlertSettings(deps), require, find, save, record };
}

describe('ManageAlertSettings.get', () => {
  it('requires alerts.infra.manage and returns the stored settings', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.get();

    expect(harness.require).toHaveBeenCalledWith({ permission: 'alerts.infra.manage' });
    expect(result).toEqual({ ok: true, value: DEFAULT_RECORD });
  });

  it('reads nothing without the permission', async () => {
    const harness = buildHarness({ allowed: false });

    await expect(harness.useCase.get()).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(harness.find).not.toHaveBeenCalled();
  });
});

describe('ManageAlertSettings.update', () => {
  it('saves the channels with the actor and audits only the booleans and the version', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.update({
      infrastructure: { email: true, telegram: false },
      expectedVersion: 0,
    });

    expect(harness.require).toHaveBeenCalledWith({ permission: 'alerts.infra.manage' });
    expect(harness.save).toHaveBeenCalledWith({
      infrastructure: { email: true, telegram: false },
      updatedBy: ACTOR_ID,
      expectedVersion: 0,
    });
    expect(result).toMatchObject({ ok: true, value: { version: 1 } });
    expect(harness.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.alert_settings_updated',
        actorId: ACTOR_ID,
        targetType: 'alert_settings',
        targetId: null,
        outcome: 'success',
        metadata: { infraEmail: true, infraTelegram: false, version: 1 },
      }),
    );
  });

  it('rejects turning both channels off before writing anything', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.update({
      infrastructure: { email: false, telegram: false },
      expectedVersion: 3,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTEGRATIONS.ALERT_CHANNEL_REQUIRED' },
    });
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  });

  it('answers CONFLICT.VERSION when someone else changed the settings, without auditing', async () => {
    const harness = buildHarness({ conflict: true });

    const result = await harness.useCase.update({
      infrastructure: { email: true, telegram: true },
      expectedVersion: 2,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT.VERSION' } });
    expect(harness.record).not.toHaveBeenCalled();
  });

  it('writes nothing without the permission', async () => {
    const harness = buildHarness({ allowed: false });

    await expect(
      harness.useCase.update({
        infrastructure: { email: true, telegram: true },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'AUTHZ.PERMISSION' });
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.record).not.toHaveBeenCalled();
  });

  it('requires an authenticated actor', async () => {
    const harness = buildHarness({ actorId: null });

    await expect(
      harness.useCase.update({
        infrastructure: { email: true, telegram: true },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'AUTHZ.SESSION' });
    expect(harness.save).not.toHaveBeenCalled();
  });
});
