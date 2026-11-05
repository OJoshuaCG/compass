import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import { ManageInboundConfiguration } from './manage-inbound-configuration.js';
import type {
  InboundConfigurationRepository,
  SourceRecord,
  ViewRecord,
} from './ports/inbound-configuration-repository.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000001';
const VIEW_ID = '0198bbbb-0000-7000-8000-000000000002';
const ACCOUNT_ID = '0198bbbb-0000-7000-8000-000000000003';
const TEMPLATE_A = '0198cccc-0000-7000-8000-000000000001';
const TEMPLATE_B = '0198cccc-0000-7000-8000-000000000002';
const NEW_ID = '0198dddd-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-02T12:00:00Z');

type Level = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE' | null;

const sourceRecord: SourceRecord = {
  id: SOURCE_ID,
  channel: 'mail',
  address: 'codes@example.com',
  displayName: 'Codes',
  accountId: null,
  status: 'active',
  createdAt: NOW,
};
const viewRecord: ViewRecord = {
  id: VIEW_ID,
  sourceId: SOURCE_ID,
  name: 'Main',
  templateIds: [TEMPLATE_A],
  createdAt: NOW,
};

interface HarnessOptions {
  readonly resourceLevel?: Level;
  readonly sourceExists?: boolean;
  readonly viewExists?: boolean;
  readonly accountActive?: boolean;
  readonly accountLevel?: Level;
  readonly liveTemplates?: number;
  readonly insertSource?: 'inserted' | 'address_taken';
  readonly insertView?: 'inserted' | 'name_taken';
  readonly rename?: 'renamed' | 'name_taken';
  readonly permissionRejection?: DomainError;
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) => Promise.resolve(ok(event as never)));
  const insertManageShare = vi.fn(() => Promise.resolve());
  const insertSource = vi.fn(() => Promise.resolve(options.insertSource ?? 'inserted'));
  const insertView = vi.fn(() => Promise.resolve(options.insertView ?? 'inserted'));
  const updateSource = vi.fn(
    (_id: string, edit: { displayName: string; accountId: string | null }) =>
      Promise.resolve({ ...sourceRecord, ...edit }),
  );
  const archiveSource = vi.fn(() => Promise.resolve({ revokedShares: 3 }));
  const archiveView = vi.fn(() => Promise.resolve({ revokedShares: 2 }));
  const replaceTemplates = vi.fn(() => Promise.resolve({ added: 1, removed: 2 }));
  const renameView = vi.fn(() => Promise.resolve(options.rename ?? 'renamed'));
  const lockAccountForShare = vi.fn(() => Promise.resolve());
  const configuration: InboundConfigurationRepository = {
    findSourceForUpdate: () =>
      Promise.resolve(options.sourceExists === false ? null : sourceRecord),
    findViewForUpdate: () => Promise.resolve(options.viewExists === false ? null : viewRecord),
    resourceLevel: () =>
      Promise.resolve(options.resourceLevel === undefined ? 'MANAGE' : options.resourceLevel),
    accountIsActive: () => Promise.resolve(options.accountActive !== false),
    lockAccountForShare,
    accountLevel: () =>
      Promise.resolve(options.accountLevel === undefined ? 'USE' : options.accountLevel),
    countLiveTemplates: () => Promise.resolve(options.liveTemplates ?? 2),
    insertSource,
    updateSource,
    archiveSource,
    insertView,
    renameView,
    replaceTemplates,
    findView: () => Promise.resolve(viewRecord),
    findSource: () => Promise.resolve(sourceRecord),
    archiveView,
    insertManageShare,
  };
  const useCase = new ManageInboundConfiguration({
    context: {
      current: () => ({
        organizationId: asOrganizationId('0198eeee-0000-7000-8000-000000000001'),
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
    configuration,
    ids: { next: () => NEW_ID },
    audit: { record: auditRecord },
    clock: { now: () => NOW },
  });
  return {
    useCase,
    require,
    auditDenial,
    auditRecord,
    insertManageShare,
    insertSource,
    insertView,
    updateSource,
    archiveSource,
    archiveView,
    replaceTemplates,
    renameView,
    lockAccountForShare,
  };
}

const newSource = { address: 'codes@example.com', displayName: 'Codes' };
const newView = { sourceId: SOURCE_ID, name: 'Main', templateIds: [TEMPLATE_A, TEMPLATE_B] };

describe('ManageInboundConfiguration.createSource', () => {
  it('crea la fuente, da MANAGE a quien la crea y audita al final', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.createSource(newSource);

    expect(result.ok).toBe(true);
    expect(harness.insertManageShare).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'mail_source', userId: ACTOR_ID }),
    );
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbound.source_created', metadata: { channel: 'mail' } }),
    );
  });

  it('sin el permiso inbound.configure no escribe nada', async () => {
    const harness = buildHarness({
      permissionRejection: new DomainError('AUTHZ.PERMISSION', 'no'),
    });

    await expect(harness.useCase.createSource(newSource)).rejects.toThrow();

    expect(harness.insertSource).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('una dirección repetida se responde INBOUND.SOURCE_ADDRESS_TAKEN y no audita éxito', async () => {
    const harness = buildHarness({ insertSource: 'address_taken' });

    const result = await harness.useCase.createSource(newSource);

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.SOURCE_ADDRESS_TAKEN' } });
    expect(harness.insertManageShare).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('ligar una cuenta pide USE sobre ella y bloquea la cuenta antes de leer el nivel', async () => {
    const harness = buildHarness({ accountLevel: 'USE' });

    const result = await harness.useCase.createSource({ ...newSource, accountId: ACCOUNT_ID });

    expect(result.ok).toBe(true);
    expect(harness.lockAccountForShare).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it.each<Level>([null])(
    'una cuenta sin nivel del actor se responde INBOUND.ACCOUNT_INVALID',
    async (level) => {
      const harness = buildHarness({ accountLevel: level });

      const result = await harness.useCase.createSource({ ...newSource, accountId: ACCOUNT_ID });

      expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.ACCOUNT_INVALID' } });
      expect(harness.insertSource).not.toHaveBeenCalled();
      expect(harness.auditDenial).toHaveBeenCalled();
    },
  );

  it('una cuenta archivada se responde INBOUND.ACCOUNT_INVALID', async () => {
    const harness = buildHarness({ accountActive: false });

    const result = await harness.useCase.createSource({ ...newSource, accountId: ACCOUNT_ID });

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.ACCOUNT_INVALID' } });
    expect(harness.insertSource).not.toHaveBeenCalled();
    expect(harness.auditDenial).toHaveBeenCalled();
  });
});

describe('ManageInboundConfiguration.updateSource', () => {
  it('con EDIT cambia el nombre y audita los campos cambiados', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.updateSource(SOURCE_ID, { displayName: 'Nuevo' });

    expect(result.ok).toBe(true);
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.source_updated',
        metadata: { changedFields: 'displayName' },
      }),
    );
  });

  it.each<Level>(['USE', 'VIEW'])(
    'con nivel %s se niega con AUTHZ.SHARE y se audita',
    async (level) => {
      const harness = buildHarness({ resourceLevel: level });

      const result = await harness.useCase.updateSource(SOURCE_ID, { displayName: 'Nuevo' });

      expect(result).toMatchObject({ ok: false, error: { code: 'AUTHZ.SHARE' } });
      expect(harness.updateSource).not.toHaveBeenCalled();
      expect(harness.auditDenial).toHaveBeenCalledWith(
        expect.objectContaining({ targetSourceId: SOURCE_ID }),
      );
    },
  );

  it('sin nivel o fuente inexistente se responde NOT_FOUND y se audita', async () => {
    const withoutLevel = buildHarness({ resourceLevel: null });
    const missing = buildHarness({ sourceExists: false });

    expect(await withoutLevel.useCase.updateSource(SOURCE_ID, { displayName: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await missing.useCase.updateSource(SOURCE_ID, { displayName: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(withoutLevel.auditDenial).toHaveBeenCalled();
    expect(missing.auditDenial).toHaveBeenCalled();
  });

  it('desligar la cuenta (null) no valida cuenta y audita accountId', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.updateSource(SOURCE_ID, { accountId: null });

    expect(result.ok).toBe(true);
  });
});

describe('ManageInboundConfiguration.archiveSource', () => {
  it('con MANAGE archiva y audita las comparticiones revocadas', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.archiveSource(SOURCE_ID);

    expect(result.ok).toBe(true);
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.source_archived',
        metadata: { revokedShares: 3 },
      }),
    );
  });

  it('con EDIT no puede archivar', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.archiveSource(SOURCE_ID);

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTHZ.SHARE' } });
    expect(harness.archiveSource).not.toHaveBeenCalled();
  });
});

describe('ManageInboundConfiguration.createView', () => {
  it('con EDIT sobre la fuente crea la vista, sus plantillas y MANAGE para quien la crea', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.createView(newView);

    expect(result.ok).toBe(true);
    expect(harness.replaceTemplates).toHaveBeenCalledWith(NEW_ID, [TEMPLATE_A, TEMPLATE_B]);
    expect(harness.insertManageShare).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'mail_view', userId: ACTOR_ID }),
    );
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.view_created',
        metadata: { sourceId: SOURCE_ID, templateCount: 2 },
      }),
    );
  });

  it('con VIEW sobre la fuente se niega', async () => {
    const harness = buildHarness({ resourceLevel: 'VIEW' });

    const result = await harness.useCase.createView(newView);

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTHZ.SHARE' } });
    expect(harness.insertView).not.toHaveBeenCalled();
  });

  it('una plantilla inexistente o archivada se responde INBOUND.TEMPLATE_INVALID', async () => {
    const harness = buildHarness({ liveTemplates: 1 });

    const result = await harness.useCase.createView(newView);

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.TEMPLATE_INVALID' } });
    expect(harness.insertView).not.toHaveBeenCalled();
  });

  it('las plantillas repetidas se cuentan una sola vez', async () => {
    const harness = buildHarness({ liveTemplates: 1 });

    const result = await harness.useCase.createView({
      ...newView,
      templateIds: [TEMPLATE_A, TEMPLATE_A],
    });

    expect(result.ok).toBe(true);
    expect(harness.replaceTemplates).toHaveBeenCalledWith(NEW_ID, [TEMPLATE_A]);
  });

  it('un nombre repetido en la fuente se responde INBOUND.VIEW_NAME_TAKEN', async () => {
    const harness = buildHarness({ insertView: 'name_taken' });

    const result = await harness.useCase.createView(newView);

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.VIEW_NAME_TAKEN' } });
    expect(harness.insertManageShare).not.toHaveBeenCalled();
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('una fuente sin nivel se responde NOT_FOUND y se audita', async () => {
    const harness = buildHarness({ resourceLevel: null });

    const result = await harness.useCase.createView(newView);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(harness.auditDenial).toHaveBeenCalledWith(
      expect.objectContaining({ targetSourceId: SOURCE_ID }),
    );
  });
});

describe('ManageInboundConfiguration.updateView', () => {
  it('con EDIT cambia plantillas y nombre y audita lo agregado y lo quitado', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.updateView(VIEW_ID, {
      name: 'Otro',
      templateIds: [TEMPLATE_A, TEMPLATE_B],
    });

    expect(result.ok).toBe(true);
    expect(harness.renameView).toHaveBeenCalledWith(VIEW_ID, 'Otro');
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.view_updated',
        metadata: { sourceId: SOURCE_ID, addedCount: 1, removedCount: 2 },
      }),
    );
  });

  it('con USE se niega y se audita con targetViewId', async () => {
    const harness = buildHarness({ resourceLevel: 'USE' });

    const result = await harness.useCase.updateView(VIEW_ID, { name: 'Otro' });

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTHZ.SHARE' } });
    expect(harness.renameView).not.toHaveBeenCalled();
    expect(harness.auditDenial).toHaveBeenCalledWith(
      expect.objectContaining({ targetViewId: VIEW_ID }),
    );
  });

  it('una plantilla inválida no cambia nada', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT', liveTemplates: 0 });

    const result = await harness.useCase.updateView(VIEW_ID, { templateIds: [TEMPLATE_A] });

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.TEMPLATE_INVALID' } });
    expect(harness.replaceTemplates).not.toHaveBeenCalled();
  });

  it('un nombre ya usado junto con plantillas no deja las plantillas cambiadas', async () => {
    const harness = buildHarness({
      resourceLevel: 'EDIT',
      rename: 'name_taken',
      liveTemplates: 1,
    });

    const result = await harness.useCase.updateView(VIEW_ID, {
      name: 'Otro',
      templateIds: [TEMPLATE_B],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.VIEW_NAME_TAKEN' } });
    // La unidad de trabajo confirma cualquier retorno que no lance: no debe haber escrito nada antes del err.
    expect(harness.replaceTemplates).not.toHaveBeenCalled();
  });

  it('un nombre ya usado se responde INBOUND.VIEW_NAME_TAKEN', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT', rename: 'name_taken' });

    const result = await harness.useCase.updateView(VIEW_ID, { name: 'Otro' });

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.VIEW_NAME_TAKEN' } });
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });
});

describe('ManageInboundConfiguration.archiveView', () => {
  it('con MANAGE archiva y audita las comparticiones revocadas', async () => {
    const harness = buildHarness();

    const result = await harness.useCase.archiveView(VIEW_ID);

    expect(result.ok).toBe(true);
    expect(harness.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.view_archived',
        metadata: { sourceId: SOURCE_ID, revokedShares: 2 },
      }),
    );
  });

  it('con EDIT no puede archivar', async () => {
    const harness = buildHarness({ resourceLevel: 'EDIT' });

    const result = await harness.useCase.archiveView(VIEW_ID);

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTHZ.SHARE' } });
    expect(harness.archiveView).not.toHaveBeenCalled();
  });
});
