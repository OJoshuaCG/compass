import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, err, ok } from '../../../shared/kernel/index.js';
import { decryptFailed } from '../../crypto/domain/crypto-errors.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { ResetRevealNoticePayload } from '../domain/reset-reveal-notice.js';
import type { LiveResetRecord } from './ports/inbound-reset-store.js';
import { MAX_RESETS_PER_REVEAL, RevealInboundResets } from './reveal-inbound-resets.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const VIEW_ID = '0198bbbb-0000-7000-8000-000000000001';
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000002';
const ITEM_CODE = '0198cccc-0000-7000-8000-000000000001';
const ITEM_LINK = '0198cccc-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-03T12:05:00Z');
const SECRET_VALUE = '739104';
const VALID_REASON = '  Soporte pidió restablecer el acceso del proveedor  ';

type Level = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE' | null;

function resetRecord(itemId: string, overrides: Partial<LiveResetRecord> = {}): LiveResetRecord {
  return {
    itemId,
    kind: 'reset_code',
    valueType: 'code',
    ciphertext: new Uint8Array([1]),
    nonce: new Uint8Array([2]),
    dekVersion: 1,
    expiresAt: new Date('2026-11-03T12:30:00Z'),
    ...overrides,
  };
}

interface HarnessOptions {
  readonly level?: Level;
  readonly viewExists?: boolean;
  readonly records?: readonly LiveResetRecord[];
  readonly permissionRejection?: DomainError;
  readonly decryptFailsOn?: string;
}

function buildHarness(options: HarnessOptions = {}) {
  const plaintexts: Uint8Array[] = [];
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) => Promise.resolve(ok(event as never)));
  const listLiveResets = vi.fn(() => Promise.resolve(options.records ?? [resetRecord(ITEM_CODE)]));
  const enqueuedNotices: ResetRevealNoticePayload[] = [];
  const enqueueRevealNotice = vi.fn((notice: ResetRevealNoticePayload) => {
    enqueuedNotices.push(notice);
    return Promise.resolve();
  });
  const decrypt = vi.fn((context: { recordId?: string } & Record<string, unknown>) => {
    const serialized = JSON.stringify(context);
    if (options.decryptFailsOn !== undefined && serialized.includes(options.decryptFailsOn)) {
      return Promise.resolve(err(decryptFailed()));
    }
    const plaintext = new TextEncoder().encode(SECRET_VALUE);
    plaintexts.push(plaintext);
    return Promise.resolve(ok(plaintext));
  });

  const useCase = new RevealInboundResets({
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
    views: {
      findLiveView: () =>
        Promise.resolve(options.viewExists === false ? null : { id: VIEW_ID, sourceId: SOURCE_ID }),
      effectiveLevel: () => Promise.resolve(options.level === undefined ? 'MANAGE' : options.level),
    },
    resets: { listLiveResets, enqueueRevealNotice },
    cipher: { decrypt } as unknown as SecretCipher,
    audit: { record: auditRecord },
    clock: { now: () => NOW },
  });
  return {
    useCase,
    require,
    auditDenial,
    auditRecord,
    listLiveResets,
    enqueueRevealNotice,
    enqueuedNotices,
    decrypt,
    plaintexts,
  };
}

describe('RevealInboundResets: autorización', () => {
  it('pide el permiso inbound.reveal_reset (el motor exige la reautenticación)', async () => {
    const { useCase, require } = buildHarness();

    await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(require).toHaveBeenCalledWith({ permission: 'inbound.reveal_reset' });
  });

  it('si el motor niega (permiso o reautenticación) no lista ni descifra nada', async () => {
    const { useCase, listLiveResets, decrypt, auditRecord } = buildHarness({
      permissionRejection: new DomainError('AUTHZ.REAUTH_REQUIRED', 'Action not allowed'),
    });

    await expect(useCase.reveal(VIEW_ID, VALID_REASON)).rejects.toMatchObject({
      code: 'AUTHZ.REAUTH_REQUIRED',
    });
    expect(listLiveResets).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it.each(['USE', 'VIEW', 'EDIT'] as const)(
    'con nivel %s niega con AUTHZ.SHARE, audita la negación y no descifra',
    async (level) => {
      const { useCase, auditDenial, decrypt, listLiveResets } = buildHarness({ level });

      const result = await useCase.reveal(VIEW_ID, VALID_REASON);

      expect(!result.ok && result.error.code).toBe('AUTHZ.SHARE');
      expect(auditDenial).toHaveBeenCalledWith({
        code: 'AUTHZ.SHARE',
        permission: 'inbound.reveal_reset',
        targetViewId: VIEW_ID,
      });
      expect(listLiveResets).not.toHaveBeenCalled();
      expect(decrypt).not.toHaveBeenCalled();
    },
  );

  it('sin nivel responde NOT_FOUND y audita la negación', async () => {
    const { useCase, auditDenial, listLiveResets } = buildHarness({ level: null });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.SHARE',
      permission: 'inbound.reveal_reset',
      targetViewId: VIEW_ID,
    });
    expect(listLiveResets).not.toHaveBeenCalled();
  });

  it('una vista inexistente o inactiva responde NOT_FOUND igual y también se audita', async () => {
    const { useCase, auditDenial, listLiveResets } = buildHarness({ viewExists: false });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledTimes(1);
    expect(listLiveResets).not.toHaveBeenCalled();
  });
});

describe('RevealInboundResets: motivo escrito', () => {
  it.each([undefined, '', '     ', 'corto', 'x'.repeat(501)])(
    'sin motivo válido (%o) niega con CREDENTIAL.REASON_INVALID, audita y no descifra',
    async (reason) => {
      const { useCase, auditDenial, decrypt, auditRecord, enqueueRevealNotice } = buildHarness();

      const result = await useCase.reveal(VIEW_ID, reason);

      expect(!result.ok && result.error.code).toBe('CREDENTIAL.REASON_INVALID');
      expect(auditDenial).toHaveBeenCalledWith({
        code: 'CREDENTIAL.REASON_INVALID',
        permission: 'inbound.reveal_reset',
        targetViewId: VIEW_ID,
      });
      expect(decrypt).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
      expect(enqueueRevealNotice).not.toHaveBeenCalled();
    },
  );
});

describe('RevealInboundResets: revelación', () => {
  it('entrega cada restablecimiento con su tipo y borra el búfer descifrado', async () => {
    const { useCase, plaintexts } = buildHarness({
      records: [
        resetRecord(ITEM_CODE),
        resetRecord(ITEM_LINK, { kind: 'reset_link', valueType: 'link' }),
      ],
    });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(result.ok && result.value).toEqual([
      {
        itemId: ITEM_CODE,
        kind: 'reset_code',
        valueType: 'code',
        value: SECRET_VALUE,
        expiresAt: new Date('2026-11-03T12:30:00Z'),
      },
      {
        itemId: ITEM_LINK,
        kind: 'reset_link',
        valueType: 'link',
        value: SECRET_VALUE,
        expiresAt: new Date('2026-11-03T12:30:00Z'),
      },
    ]);
    expect(plaintexts.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it('escribe una auditoría crítica por elemento con el motivo recortado y nunca el valor', async () => {
    const { useCase, auditRecord } = buildHarness({
      records: [resetRecord(ITEM_CODE), resetRecord(ITEM_LINK)],
    });

    await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(auditRecord).toHaveBeenCalledTimes(2);
    expect(auditRecord).toHaveBeenNthCalledWith(1, {
      action: 'inbound.reset_revealed',
      actorId: ACTOR_ID,
      targetType: 'inbound_item',
      targetId: ITEM_CODE,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: 'req-1',
      metadata: {
        sourceId: SOURCE_ID,
        viewId: VIEW_ID,
        reason: 'Soporte pidió restablecer el acceso del proveedor',
      },
    });
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain(SECRET_VALUE);
  });

  it('cada revelación vuelve a auditar: no se deduplica', async () => {
    const { useCase, auditRecord } = buildHarness();

    await useCase.reveal(VIEW_ID, VALID_REASON);
    await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(auditRecord).toHaveBeenCalledTimes(2);
  });

  it('encola un solo aviso a la Raíz con el conteo y la hora, sin valores ni motivo', async () => {
    const { useCase, enqueuedNotices } = buildHarness({
      records: [resetRecord(ITEM_CODE), resetRecord(ITEM_LINK)],
    });

    await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(enqueuedNotices).toEqual([
      { actorId: ACTOR_ID, viewId: VIEW_ID, revealedCount: 2, revealedAt: NOW },
    ]);
  });

  it('pide como máximo MAX_RESETS_PER_REVEAL elementos vigentes a la hora del reloj', async () => {
    const { useCase, listLiveResets } = buildHarness();

    await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(listLiveResets).toHaveBeenCalledWith(VIEW_ID, NOW, MAX_RESETS_PER_REVEAL);
  });

  it('descarta lo vencido aunque la consulta lo devuelva (segunda barrera)', async () => {
    const { useCase, decrypt, auditRecord } = buildHarness({
      records: [resetRecord(ITEM_CODE, { expiresAt: new Date('2026-11-03T12:00:00Z') })],
    });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(result.ok && result.value).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'mail_view', targetId: VIEW_ID }),
    );
  });

  it('sin restablecimientos vigentes audita el intento sobre la vista y no avisa a la Raíz', async () => {
    const { useCase, auditRecord, enqueueRevealNotice } = buildHarness({ records: [] });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(result.ok && result.value).toEqual([]);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith({
      action: 'inbound.reset_revealed',
      actorId: ACTOR_ID,
      targetType: 'mail_view',
      targetId: VIEW_ID,
      outcome: 'success',
      reasonCode: null,
      ip: null,
      requestId: 'req-1',
      metadata: {
        sourceId: SOURCE_ID,
        viewId: VIEW_ID,
        reason: 'Soporte pidió restablecer el acceso del proveedor',
      },
    });
    expect(enqueueRevealNotice).not.toHaveBeenCalled();
  });

  it('si un elemento no se puede descifrar deja solo una auditoría de fallo y no avisa', async () => {
    const { useCase, auditRecord, enqueueRevealNotice } = buildHarness({
      records: [resetRecord(ITEM_CODE), resetRecord(ITEM_LINK)],
      decryptFailsOn: ITEM_LINK,
    });

    const result = await useCase.reveal(VIEW_ID, VALID_REASON);

    expect(result.ok).toBe(false);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.reset_revealed',
        targetType: 'inbound_item',
        targetId: ITEM_LINK,
        outcome: 'failure',
        reasonCode: 'CRYPTO.DECRYPT_FAILED',
      }),
    );
    expect(enqueueRevealNotice).not.toHaveBeenCalled();
  });

  it('si la auditoría no se puede escribir lanza (revierte) y no entrega valores', async () => {
    const harness = buildHarness();
    harness.auditRecord.mockImplementationOnce(() =>
      Promise.resolve(
        err(new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'rejected')) as never,
      ),
    );

    await expect(harness.useCase.reveal(VIEW_ID, VALID_REASON)).rejects.toMatchObject({
      code: 'AUDIT.METADATA_FIELD_NOT_ALLOWED',
    });
    expect(harness.enqueueRevealNotice).not.toHaveBeenCalled();
  });
});
