import { describe, expect, it, vi } from 'vitest';

import { DomainError, asOrganizationId, asUserId, ok } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UserRecord } from '../../directory/index.js';
import { MAIL_PREVIEW_TTL_MS } from '../domain/mail-preview.js';
import type { MailDeleteTarget } from './ports/mail-delete-request-store.js';
import type { ReadyMailPreview } from './ports/mail-preview-request-store.js';
import { PreviewInboundMail } from './preview-inbound-mail.js';

const ACTOR_ID = asUserId('0198aaaa-0000-7000-8000-000000000001');
const OTHER_ID = asUserId('0198aaaa-0000-7000-8000-000000000002');
const ORGANIZATION_ID = asOrganizationId('0198dddd-0000-7000-8000-000000000001');
const RECEIPT_ID = '0198bbbb-0000-7000-8000-000000000001';
const SOURCE_ID = '0198bbbb-0000-7000-8000-000000000002';
const REQUEST_ID = '0198cccc-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-14T12:00:00.000Z');
const VALID_REASON = 'Confirmar que es el correo de restablecimiento';

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
  readonly ready?: ReadyMailPreview | null;
  readonly decryptFails?: boolean;
  readonly auditFails?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const require = vi.fn(() => Promise.resolve([]));
  const auditDenial = vi.fn(() => Promise.resolve());
  const auditRecord = vi.fn((event: { action: string }) =>
    Promise.resolve(
      options.auditFails === true
        ? { ok: false as const, error: new DomainError('AUDIT.METADATA_FIELD_NOT_ALLOWED', 'audit down') }
        : ok(event as never),
    ),
  );
  const insertPending = vi.fn(() => Promise.resolve(options.insertResult ?? 'created'));
  const findLatest = vi.fn(() => Promise.resolve(null));
  const takeReady = vi.fn(() =>
    Promise.resolve(
      options.ready === undefined
        ? {
            requestId: REQUEST_ID,
            ciphertext: new Uint8Array(20),
            nonce: new Uint8Array(12),
            dekVersion: 1,
          }
        : options.ready,
    ),
  );
  const decrypt = vi.fn(() =>
    Promise.resolve(
      options.decryptFails === true
        ? { ok: false as const, error: new DomainError('CRYPTO.DECRYPT_FAILED', 'cannot decrypt') }
        : ok(new TextEncoder().encode('Restablece tu clave')),
    ),
  );
  const useCase = new PreviewInboundMail({
    context: {
      current: () => ({
        organizationId: ORGANIZATION_ID,
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
    targets: {
      findTarget: () => Promise.resolve(options.target === undefined ? target() : options.target),
    },
    previews: { insertPending, findLatest, takeReady },
    cipher: { decrypt } as unknown as SecretCipher,
    audit: { record: auditRecord },
    clock: { now: () => NOW },
  });
  return { useCase, require, auditDenial, auditRecord, insertPending, takeReady, decrypt };
}

describe('PreviewInboundMail.request', () => {
  it('el asunto pide solo inbound.delete_mail', async () => {
    const { useCase, require } = buildHarness();

    await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(require).toHaveBeenCalledTimes(1);
    expect(require).toHaveBeenCalledWith({ permission: 'inbound.delete_mail' });
  });

  it('el cuerpo pide también inbound.reveal_reset', async () => {
    const { useCase, require } = buildHarness();

    await useCase.request(RECEIPT_ID, 'body', VALID_REASON);

    expect(require).toHaveBeenCalledWith({ permission: 'inbound.delete_mail' });
    expect(require).toHaveBeenCalledWith({ permission: 'inbound.reveal_reset' });
  });

  it('registra la petición con la posición del recibo, vida de 15 minutos y auditoría sin contenido', async () => {
    const { useCase, insertPending, auditRecord } = buildHarness();

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result).toEqual(ok({ alreadyPending: false }));
    expect(insertPending).toHaveBeenCalledWith(
      {
        receiptId: RECEIPT_ID,
        sourceId: SOURCE_ID,
        kind: 'subject',
        mailboxUidValidity: 77,
        mailboxUid: 1234,
        requestedBy: ACTOR_ID,
        expiresAt: new Date(NOW.getTime() + MAIL_PREVIEW_TTL_MS),
      },
      NOW,
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.mail_preview_requested',
        targetId: RECEIPT_ID,
        metadata: { sourceId: SOURCE_ID, kind: 'subject' },
      }),
    );
  });

  it('si ya hay una petición viva responde igual sin auditar de nuevo', async () => {
    const { useCase, auditRecord } = buildHarness({ insertResult: 'already_pending' });

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result).toEqual(ok({ alreadyPending: true }));
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('el cuerpo sin motivo válido se niega, se audita y no registra nada', async () => {
    const { useCase, auditDenial, insertPending } = buildHarness();

    const result = await useCase.request(RECEIPT_ID, 'body', 'corto');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CREDENTIAL.REASON_INVALID');
    expect(auditDenial).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CREDENTIAL.REASON_INVALID' }),
    );
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('quien no es Administrador ni dio de alta la fuente recibe NOT_FOUND y la negación se audita', async () => {
    const { useCase, auditDenial, insertPending } = buildHarness({
      target: target({ sourceCreatedBy: OTHER_ID }),
      actorRank: 2,
    });

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(auditDenial).toHaveBeenCalledTimes(1);
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('un Administrador puede ver el correo de una fuente ajena', async () => {
    const { useCase } = buildHarness({
      target: target({ sourceCreatedBy: OTHER_ID }),
      actorRank: 1,
    });

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(true);
  });

  it('un recibo inexistente responde NOT_FOUND igual', async () => {
    const { useCase } = buildHarness({ target: null });

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('un recibo sin posición guardada no se puede ver', async () => {
    const { useCase, insertPending } = buildHarness({
      target: target({ mailboxUid: null, mailboxUidValidity: null }),
    });

    const result = await useCase.request(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INBOUND.MAIL_NOT_PREVIEWABLE');
    expect(insertPending).not.toHaveBeenCalled();
  });

  it('si la auditoría no se puede escribir lanza para revertir la petición', async () => {
    const { useCase } = buildHarness({ auditFails: true });

    await expect(useCase.request(RECEIPT_ID, 'subject', undefined)).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe('PreviewInboundMail.read', () => {
  it('entrega el asunto descifrado con el contexto de la petición y lo audita sin contenido', async () => {
    const { useCase, decrypt, auditRecord } = buildHarness();

    const result = await useCase.read(RECEIPT_ID, 'subject', undefined);

    expect(result).toEqual(ok('Restablece tu clave'));
    expect(decrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        resourceId: REQUEST_ID,
        field: 'mail_preview',
      }),
      expect.objectContaining({ dekVersion: 1 }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.mail_subject_viewed',
        outcome: 'success',
        metadata: { sourceId: SOURCE_ID },
      }),
    );
  });

  it('el cuerpo se audita con el motivo recortado', async () => {
    const { useCase, auditRecord } = buildHarness();

    await useCase.read(RECEIPT_ID, 'body', `  ${VALID_REASON}  `);

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound.mail_body_viewed',
        metadata: { sourceId: SOURCE_ID, reason: VALID_REASON },
      }),
    );
  });

  it('el cuerpo sin motivo válido no toma ni descifra nada', async () => {
    const { useCase, takeReady, decrypt } = buildHarness();

    const result = await useCase.read(RECEIPT_ID, 'body', undefined);

    expect(result.ok).toBe(false);
    expect(takeReady).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('sin contenido listo responde NOT_FOUND y no audita una vista que no ocurrió', async () => {
    const { useCase, auditRecord, decrypt } = buildHarness({ ready: null });

    const result = await useCase.read(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(decrypt).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('un descifrado fallido no entrega nada y deja auditoría de fallo', async () => {
    const { useCase, auditRecord } = buildHarness({ decryptFails: true });

    const result = await useCase.read(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reasonCode: 'CRYPTO.DECRYPT_FAILED' }),
    );
  });

  it('si la auditoría no se puede escribir lanza y el contenido no sale', async () => {
    const { useCase } = buildHarness({ auditFails: true });

    await expect(useCase.read(RECEIPT_ID, 'subject', undefined)).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('quien no puede ver el correo no llega a tomar el contenido', async () => {
    const { useCase, takeReady } = buildHarness({
      target: target({ sourceCreatedBy: OTHER_ID }),
      actorRank: 2,
    });

    const result = await useCase.read(RECEIPT_ID, 'subject', undefined);

    expect(result.ok).toBe(false);
    expect(takeReady).not.toHaveBeenCalled();
  });
});
