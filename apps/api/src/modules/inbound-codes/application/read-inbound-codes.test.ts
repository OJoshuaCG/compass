import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, err, ok } from '../../../shared/kernel/index.js';
import { decryptFailed } from '../../crypto/domain/crypto-errors.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { encodeHistoryCursor } from '../domain/history-cursor.js';
import type { LiveLoginCodeRecord, ReceiptHistoryRecord } from './ports/inbound-view-reader.js';
import { MAX_HISTORY_PAGE_SIZE, ReadInboundCodes } from './read-inbound-codes.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const VIEW_ID = '0198bbbb-0000-7000-8000-000000000001';
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000002';
const ITEM_A = '0198cccc-0000-7000-8000-000000000001';
const ITEM_B = '0198cccc-0000-7000-8000-000000000002';
const NOW = new Date('2026-11-02T12:05:00Z');
const SECRET_CODE = '482913';

type Level = 'USE' | 'VIEW' | 'EDIT' | 'MANAGE' | null;

function codeRecord(itemId: string, overrides: Partial<LiveLoginCodeRecord> = {}) {
  return {
    itemId,
    ciphertext: new Uint8Array([1]),
    nonce: new Uint8Array([2]),
    dekVersion: 1,
    createdAt: new Date('2026-11-02T12:00:00Z'),
    expiresAt: new Date('2026-11-02T12:10:00Z'),
    ...overrides,
  } satisfies LiveLoginCodeRecord;
}

function historyRecord(id: string, receivedAt: string): ReceiptHistoryRecord {
  return {
    receiptId: id,
    receivedAt: new Date(receivedAt),
    signingDomain: 'sender.example',
    templateKind: 'login_code',
  };
}

interface HarnessOptions {
  readonly level?: Level;
  readonly viewExists?: boolean;
  readonly records?: readonly LiveLoginCodeRecord[];
  readonly history?: readonly ReceiptHistoryRecord[];
  readonly alreadyRead?: number;
  readonly permissionRejection?: DomainError;
  readonly decryptFails?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const plaintext = new TextEncoder().encode(SECRET_CODE);
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) => Promise.resolve(ok(event as never)));
  const listLiveLoginCodes = vi.fn(() => Promise.resolve(options.records ?? []));
  const listHistory = vi.fn((_viewId: string, query: { limit: number }) =>
    Promise.resolve((options.history ?? []).slice(0, query.limit)),
  );
  const lockedItemIds: string[] = [];
  const lockItemRead = vi.fn((_userId: unknown, itemId: string) => {
    lockedItemIds.push(itemId);
    return Promise.resolve();
  });
  const decrypt = vi.fn(() =>
    Promise.resolve(options.decryptFails === true ? err(decryptFailed()) : ok(plaintext)),
  );

  const useCase = new ReadInboundCodes({
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
      effectiveLevel: () => Promise.resolve(options.level === undefined ? 'USE' : options.level),
      listLiveLoginCodes,
      listHistory,
      lockItemRead,
    },
    cipher: { decrypt } as unknown as SecretCipher,
    audit: { record: auditRecord },
    auditCounter: {
      count: () => Promise.resolve(options.alreadyRead ?? 0),
    },
    clock: { now: () => NOW },
  });
  return {
    useCase,
    require,
    auditDenial,
    auditRecord,
    lockItemRead,
    lockedItemIds,
    listLiveLoginCodes,
    listHistory,
    plaintext,
  };
}

describe('ReadInboundCodes.listCodes: permission × level matrix', () => {
  // La jerarquía es USE < VIEW < EDIT < MANAGE: USE es el piso, así que todo nivel con acceso ve los códigos vivos.
  it.each(['USE', 'VIEW', 'EDIT', 'MANAGE'] as const)(
    'with level %s the live codes are delivered without a denial',
    async (level) => {
      const { useCase, auditDenial } = buildHarness({ level, records: [codeRecord(ITEM_A)] });

      const result = await useCase.listCodes(VIEW_ID);

      expect(result.ok).toBe(true);
      expect(auditDenial).not.toHaveBeenCalled();
    },
  );

  it('answers NOT_FOUND and audits the denial with the view as target when there is no level', async () => {
    const { useCase, auditDenial, listLiveLoginCodes } = buildHarness({ level: null });

    const result = await useCase.listCodes(VIEW_ID);

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.SHARE',
      permission: 'inbound.read_codes',
      targetViewId: VIEW_ID,
    });
    expect(listLiveLoginCodes).not.toHaveBeenCalled();
  });

  it('propagates the permission rejection before touching any data', async () => {
    const rejection = new DomainError('AUTHZ.PERMISSION', 'denied');
    const { useCase, listLiveLoginCodes } = buildHarness({ permissionRejection: rejection });

    await expect(useCase.listCodes(VIEW_ID)).rejects.toBe(rejection);
    expect(listLiveLoginCodes).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a view that is not live and audits the denial', async () => {
    const { useCase, auditDenial } = buildHarness({ viewExists: false });

    const result = await useCase.listCodes(VIEW_ID);

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.SHARE',
      permission: 'inbound.read_codes',
      targetViewId: VIEW_ID,
    });
  });
});

describe('ReadInboundCodes.listCodes: delivery and audit', () => {
  it('delivers the plaintext code and zeroes the decrypted buffer', async () => {
    const { useCase, plaintext } = buildHarness({ records: [codeRecord(ITEM_A)] });

    const result = await useCase.listCodes(VIEW_ID);

    expect(result.ok && result.value).toEqual([
      { itemId: ITEM_A, code: SECRET_CODE, expiresAt: new Date('2026-11-02T12:10:00Z') },
    ]);
    expect([...plaintext].every((byte) => byte === 0)).toBe(true);
  });

  it('audits one read per item without the code in the metadata', async () => {
    const { useCase, auditRecord } = buildHarness({
      records: [codeRecord(ITEM_A), codeRecord(ITEM_B)],
    });

    await useCase.listCodes(VIEW_ID);

    expect(auditRecord).toHaveBeenCalledTimes(2);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.code_read',
        targetType: 'inbound_item',
        targetId: ITEM_A,
        outcome: 'success',
        metadata: { sourceId: SOURCE_ID, viewId: VIEW_ID },
      }),
    );
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain(SECRET_CODE);
  });

  it('takes every item lock, in a stable order, before the first audit write', async () => {
    const { useCase, lockItemRead, lockedItemIds, auditRecord } = buildHarness({
      records: [codeRecord(ITEM_B), codeRecord(ITEM_A)],
    });

    await useCase.listCodes(VIEW_ID);

    expect(lockedItemIds).toEqual([ITEM_A, ITEM_B]);
    const lastLockOrder = Math.max(...lockItemRead.mock.invocationCallOrder);
    const firstAuditOrder = Math.min(...auditRecord.mock.invocationCallOrder);
    expect(lastLockOrder).toBeLessThan(firstAuditOrder);
  });

  it('does not audit again when the person already read that item', async () => {
    const { useCase, auditRecord } = buildHarness({
      records: [codeRecord(ITEM_A)],
      alreadyRead: 1,
    });

    const result = await useCase.listCodes(VIEW_ID);

    expect(result.ok).toBe(true);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('never delivers an item that expired by the use case clock', async () => {
    const { useCase, auditRecord } = buildHarness({
      records: [codeRecord(ITEM_A, { expiresAt: NOW })],
    });

    const result = await useCase.listCodes(VIEW_ID);

    expect(result.ok && result.value).toEqual([]);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('leaves no audit when an item cannot be opened', async () => {
    const { useCase, auditRecord } = buildHarness({
      records: [codeRecord(ITEM_A)],
      decryptFails: true,
    });

    const result = await useCase.listCodes(VIEW_ID);

    expect(result.ok).toBe(false);
    expect(auditRecord).not.toHaveBeenCalled();
  });
});

describe('ReadInboundCodes.history', () => {
  it.each(['VIEW', 'EDIT', 'MANAGE'] as const)('allows level %s', async (level) => {
    const { useCase } = buildHarness({ level });

    expect((await useCase.history(VIEW_ID, {})).ok).toBe(true);
  });

  it('denies USE alone with AUTHZ.SHARE and audits it', async () => {
    const { useCase, auditDenial, listHistory } = buildHarness({ level: 'USE' });

    const result = await useCase.history(VIEW_ID, {});

    expect(!result.ok && result.error.code).toBe('AUTHZ.SHARE');
    expect(auditDenial).toHaveBeenCalledOnce();
    expect(listHistory).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND without any level', async () => {
    const { useCase, auditDenial } = buildHarness({ level: null });

    const result = await useCase.history(VIEW_ID, {});

    expect(!result.ok && result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledOnce();
  });

  it('rejects a malformed cursor with VALIDATION.FAILED', async () => {
    const { useCase, listHistory } = buildHarness({ level: 'VIEW' });

    const result = await useCase.history(VIEW_ID, { cursor: 'not-a-cursor' });

    expect(!result.ok && result.error.code).toBe('VALIDATION.FAILED');
    expect(listHistory).not.toHaveBeenCalled();
  });

  it('returns a next cursor only when there are more rows than the limit', async () => {
    const rows = [
      historyRecord('0198eeee-0000-7000-8000-000000000003', '2026-11-02T12:03:00Z'),
      historyRecord('0198eeee-0000-7000-8000-000000000002', '2026-11-02T12:02:00Z'),
      historyRecord('0198eeee-0000-7000-8000-000000000001', '2026-11-02T12:01:00Z'),
    ];
    const { useCase } = buildHarness({ level: 'VIEW', history: rows });

    const first = await useCase.history(VIEW_ID, { limit: 2 });
    const all = await useCase.history(VIEW_ID, { limit: 3 });

    expect(first.ok && first.value.entries).toHaveLength(2);
    expect(first.ok && first.value.nextCursor).toBe(
      encodeHistoryCursor({
        receivedAt: new Date('2026-11-02T12:02:00Z'),
        id: '0198eeee-0000-7000-8000-000000000002',
      }),
    );
    expect(all.ok && all.value.nextCursor).toBeNull();
  });

  it('caps the page size and exposes no value or sender', async () => {
    const { useCase, listHistory } = buildHarness({
      level: 'VIEW',
      history: [historyRecord('0198eeee-0000-7000-8000-000000000001', '2026-11-02T12:01:00Z')],
    });

    const result = await useCase.history(VIEW_ID, { limit: 100_000 });

    expect(listHistory).toHaveBeenCalledWith(VIEW_ID, {
      limit: MAX_HISTORY_PAGE_SIZE + 1,
      after: null,
    });
    expect(result.ok && Object.keys(result.value.entries[0] ?? {}).sort()).toEqual([
      'receiptId',
      'receivedAt',
      'signingDomain',
      'templateKind',
    ]);
  });
});
