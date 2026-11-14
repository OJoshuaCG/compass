import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { UserRecord } from '../../directory/index.js';
import type { MailDeleteTarget } from './ports/mail-delete-request-store.js';
import { RequestInboundMailDelete } from './request-inbound-mail-delete.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const OTHER_ID = asUserId('0198aaaa-0000-7000-8000-000000000002');
const RECEIPT_ID = '0198bbbb-0000-7000-8000-000000000001';
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000002';

function target(overrides: Partial<MailDeleteTarget> = {}): MailDeleteTarget {
  return {
    receiptId: RECEIPT_ID,
    sourceId: SOURCE_ID,
    sourceCreatedBy: ACTOR_ID,
    mailboxUidValidity: 77,
    mailboxUid: 1234,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly target?: MailDeleteTarget | null;
  readonly actorRank?: number;
  readonly insertResult?: 'created' | 'already_pending';
  readonly permissionRejection?: DomainError;
  readonly auditFails?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() =>
    options.permissionRejection === undefined
      ? Promise.resolve([])
      : Promise.reject(options.permissionRejection),
  );
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) =>
    Promise.resolve(
      options.auditFails === true
        ? {
            ok: false as const,
            error: new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'audit down'),
          }
        : ok(event as never),
    ),
  );
  const findTarget = vi.fn(() =>
    Promise.resolve(options.target === undefined ? target() : options.target),
  );
  const insertPending = vi.fn(() => Promise.resolve(options.insertResult ?? 'created'));
  const findLatest = vi.fn(() => Promise.resolve(null));
  const useCase = new RequestInboundMailDelete({
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
    directory: {
      findById: () =>
        Promise.resolve({ id: ACTOR_ID, rank: options.actorRank ?? 2 } as unknown as UserRecord),
    },
    requests: { findTarget, insertPending, findLatest },
    audit: { record: auditRecord },
  });
  return { useCase, require, auditDenial, auditRecord, insertPending, findLatest };
}

describe('RequestInboundMailDelete', () => {
  it('pide el permiso inbound.delete_mail (el motor exige reautenticación y auditoría crítica)', async () => {
    const { useCase, require } = buildHarness();

    await useCase.request(RECEIPT_ID);

    expect(require).toHaveBeenCalledWith({ permission: 'inbound.delete_mail' });
  });

  it('si el motor niega no consulta ni registra nada', async () => {
    const { useCase, insertPending, auditRecord } = buildHarness({
      permissionRejection: new DomainError('AUTHZ.REAUTH_REQUIRED', 'Action not allowed'),
    });

    await expect(useCase.request(RECEIPT_ID)).rejects.toMatchObject({
      code: 'AUTHZ.REAUTH_REQUIRED',
    });
    expect(insertPending).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('quien dio de alta la fuente registra la petición copiando la posición del recibo', async () => {
    const { useCase, insertPending } = buildHarness({ actorRank: 2 });

    const result = await useCase.request(RECEIPT_ID);

    expect(result).toEqual({ ok: true, value: { alreadyPending: false } });
    expect(insertPending).toHaveBeenCalledWith({
      receiptId: RECEIPT_ID,
      sourceId: SOURCE_ID,
      mailboxUidValidity: 77,
      mailboxUid: 1234,
      requestedBy: ACTOR_ID,
    });
  });

  it('un Administrador puede aunque no haya dado de alta la fuente', async () => {
    const { useCase, insertPending } = buildHarness({
      actorRank: 1,
      target: target({ sourceCreatedBy: OTHER_ID }),
    });

    const result = await useCase.request(RECEIPT_ID);

    expect(result.ok).toBe(true);
    expect(insertPending).toHaveBeenCalledTimes(1);
  });

  it('un Líder que no dio de alta la fuente recibe NOT_FOUND, se audita la negación y no se registra', async () => {
    const { useCase, insertPending, auditDenial, auditRecord } = buildHarness({
      actorRank: 2,
      target: target({ sourceCreatedBy: OTHER_ID }),
    });

    const result = await useCase.request(RECEIPT_ID);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.PERMISSION',
      permission: 'inbound.delete_mail',
      targetSourceId: SOURCE_ID,
    });
    expect(insertPending).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('un recibo inexistente o de una fuente no activa responde NOT_FOUND y audita la negación', async () => {
    const { useCase, insertPending, auditDenial } = buildHarness({ target: null });

    const result = await useCase.request(RECEIPT_ID);

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(auditDenial).toHaveBeenCalledWith({
      code: 'AUTHZ.PERMISSION',
      permission: 'inbound.delete_mail',
    });
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('un recibo sin posición guardada no se puede borrar', async () => {
    const { useCase, insertPending, auditRecord } = buildHarness({
      target: target({ mailboxUid: null, mailboxUidValidity: null }),
    });

    const result = await useCase.request(RECEIPT_ID);

    expect(result).toMatchObject({ ok: false, error: { code: 'INBOUND.MAIL_NOT_DELETABLE' } });
    expect(insertPending).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('audita inbound.mail_deleted solo con la fuente: nunca la posición ni el contenido', async () => {
    const { useCase, auditRecord } = buildHarness();

    await useCase.request(RECEIPT_ID);

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.mail_deleted',
        actorId: ACTOR_ID,
        targetType: 'inbound_receipt',
        targetId: RECEIPT_ID,
        outcome: 'success',
        metadata: { sourceId: SOURCE_ID },
      }),
    );
  });

  it('si la auditoría no se puede escribir lanza para revertir la petición', async () => {
    const { useCase } = buildHarness({ auditFails: true });

    await expect(useCase.request(RECEIPT_ID)).rejects.toMatchObject({
      code: 'AUDIT.METADATA_FIELD_NOT_ALLOWED',
    });
  });

  it('con una petición ya pendiente responde igual, sin auditar otra vez', async () => {
    const { useCase, auditRecord } = buildHarness({ insertResult: 'already_pending' });

    const result = await useCase.request(RECEIPT_ID);

    expect(result).toEqual({ ok: true, value: { alreadyPending: true } });
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('el estado exige el mismo permiso y la misma pertenencia que la petición', async () => {
    const allowed = buildHarness();
    const denied = buildHarness({ actorRank: 2, target: target({ sourceCreatedBy: OTHER_ID }) });

    const allowedResult = await allowed.useCase.status(RECEIPT_ID);
    const deniedResult = await denied.useCase.status(RECEIPT_ID);

    expect(allowedResult).toEqual({ ok: true, value: null });
    expect(deniedResult).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(denied.findLatest).not.toHaveBeenCalled();
  });
});
