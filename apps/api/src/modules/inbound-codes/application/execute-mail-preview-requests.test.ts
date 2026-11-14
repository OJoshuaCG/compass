import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import { MAIL_PREVIEW_TTL_MS } from '../domain/mail-preview.js';
import type { MailPreviewKind } from '../domain/mail-preview.js';
import { POLL_MAX_MESSAGE_BYTES } from '../domain/poll-policy.js';
import {
  ExecuteMailPreviewRequests,
  MAX_MAIL_PREVIEWS_PER_SOURCE,
} from './execute-mail-preview-requests.js';
import type { MailConnectionLoadResult } from './ports/mail-connection-loader.js';
import type {
  MailPreviewFailureCode,
  PendingMailPreview,
} from './ports/mail-preview-work-store.js';
import { MailboxConnectionError, MessageFetchError } from './ports/mailbox.js';
import type { RawMessage } from './ports/mailbox.js';
import { MimeParseError } from './ports/mime-and-authenticity.js';
import type { ParsedMail } from './ports/mime-and-authenticity.js';
import { RunMailPreviewRequests } from './run-mail-preview-requests.js';

const SOURCE = {
  organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
  sourceId: 's1',
};
const NOW = new Date('2026-11-14T12:00:00Z');
const MAILBOX_UID_VALIDITY = 77;

const pendingRequest = (
  id: string,
  uid: number,
  kind: MailPreviewKind = 'subject',
  uidValidity = MAILBOX_UID_VALIDITY,
): PendingMailPreview => ({
  requestId: id,
  kind,
  mailboxUidValidity: uidValidity,
  mailboxUid: uid,
});

const parsedMail = (overrides: Partial<ParsedMail> = {}): ParsedMail => ({
  fromAddress: 'no-reply@example.test',
  toAddresses: [],
  subject: 'Tu código de acceso',
  dateHeader: null,
  headerInstanceCounts: {} as ParsedMail['headerInstanceCounts'],
  relevantHeaders: [],
  bodyText: 'Hola\nTu código es 123456',
  ...overrides,
});

const LOADED: MailConnectionLoadResult = {
  ok: true,
  connection: {
    host: 'imap.example.test',
    port: 993,
    username: 'u',
    password: 'p',
    tlsMode: 'tls',
    authservId: 'a',
    sourceAddress: 'codes@example.test',
    acceptedRecipients: [],
  },
};

interface HarnessOptions {
  readonly pending?: readonly PendingMailPreview[];
  readonly load?: MailConnectionLoadResult;
  readonly openError?: Error;
  readonly sessionUidValidity?: number;
  readonly raw?: RawMessage | Error;
  readonly parsed?: ParsedMail | Error;
  /** Lo que responde `complete`: `false` simula una fila ya cerrada o vencida. */
  readonly completeStored?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const completed: { id: string; content: string; expiresAt: Date }[] = [];
  const failed: { id: string; code: MailPreviewFailureCode }[] = [];
  const listPending = vi.fn(() => Promise.resolve(options.pending ?? []));
  const complete = vi.fn((_source: unknown, id: string, content: string, expiresAt: Date) => {
    completed.push({ id, content, expiresAt });
    return Promise.resolve(options.completeStored ?? true);
  });
  const fail = vi.fn((_source: unknown, id: string, code: MailPreviewFailureCode) => {
    failed.push({ id, code });
    return Promise.resolve();
  });
  const fetchRaw = vi.fn(() => {
    const raw = options.raw ?? { bytes: new Uint8Array([1]), truncated: false };
    return raw instanceof Error ? Promise.reject(raw) : Promise.resolve(raw);
  });
  const sessionClose = vi.fn(() => Promise.resolve());
  const load = vi.fn(() => Promise.resolve(options.load ?? LOADED));
  const open = vi.fn(() =>
    options.openError === undefined
      ? Promise.resolve({
          uidValidity: options.sessionUidValidity ?? MAILBOX_UID_VALIDITY,
          list: vi.fn(),
          fetchRaw,
          close: sessionClose,
        })
      : Promise.reject(options.openError),
  );
  const parse = vi.fn(() => {
    const parsed = options.parsed ?? parsedMail();
    return parsed instanceof Error ? Promise.reject(parsed) : Promise.resolve(parsed);
  });
  const useCase = new ExecuteMailPreviewRequests({
    work: {
      listSourcesWithPending: vi.fn(),
      listSourcesWithExpired: vi.fn(),
      listPending,
      complete,
      fail,
      purgeExpired: vi.fn(),
    },
    connections: { load },
    mailbox: { open },
    mime: { parse },
    clock: { now: () => NOW },
  });
  return { useCase, completed, failed, listPending, load, open, fetchRaw, parse, sessionClose };
}

describe('ExecuteMailPreviewRequests', () => {
  it('sin pendientes no carga la conexión ni abre el buzón', async () => {
    const { useCase, load, open } = buildHarness({ pending: [] });

    const summary = await useCase.execute(SOURCE);

    expect(summary).toEqual({ ready: 0, failed: 0, unexpected: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('pide a lo más el tope de pendientes por pasada y solo las no vencidas', async () => {
    const { useCase, listPending } = buildHarness();

    await useCase.execute(SOURCE);

    expect(listPending).toHaveBeenCalledWith(SOURCE, MAX_MAIL_PREVIEWS_PER_SOURCE, NOW);
  });

  it('deja el asunto limpio y reinicia el vencimiento a 15 minutos desde que se leyó', async () => {
    const { useCase, completed, fetchRaw } = buildHarness({
      pending: [pendingRequest('r1', 10, 'subject')],
      parsed: parsedMail({ subject: '  Tu\u202e código\ndeprueba  ' }),
    });

    const summary = await useCase.execute(SOURCE);

    expect(fetchRaw).toHaveBeenCalledWith(10, POLL_MAX_MESSAGE_BYTES);
    expect(completed).toEqual([
      {
        id: 'r1',
        content: 'Tu código deprueba',
        expiresAt: new Date(NOW.getTime() + MAIL_PREVIEW_TTL_MS),
      },
    ]);
    expect(MAIL_PREVIEW_TTL_MS).toBe(15 * 60 * 1000);
    expect(summary).toEqual({ ready: 1, failed: 0, unexpected: 0 });
  });

  it('si la fila ya se cerró o venció mientras se descargaba, no cuenta la vista previa como lista', async () => {
    const { useCase } = buildHarness({
      pending: [pendingRequest('r1', 10, 'subject')],
      parsed: parsedMail({ subject: 'Tu código' }),
      completeStored: false,
    });

    const summary = await useCase.execute(SOURCE);

    expect(summary).toEqual({ ready: 0, failed: 0, unexpected: 0 });
  });

  it('entrega el cuerpo en texto plano conservando los saltos de línea', async () => {
    const { useCase, completed } = buildHarness({
      pending: [pendingRequest('r1', 10, 'body')],
    });

    await useCase.execute(SOURCE);

    expect(completed[0]?.content).toBe('Hola\nTu código es 123456');
  });

  it('abre el buzón de solo lectura y lo cierra al terminar', async () => {
    const { useCase, open, sessionClose } = buildHarness({
      pending: [pendingRequest('r1', 10)],
    });

    await useCase.execute(SOURCE);

    expect(open).toHaveBeenCalledTimes(1);
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it('si el UIDVALIDITY cambió NO descarga nada y cierra con POSITION_CHANGED', async () => {
    const { useCase, failed, fetchRaw } = buildHarness({
      pending: [pendingRequest('r1', 10, 'subject', 76)],
    });

    const summary = await useCase.execute(SOURCE);

    expect(fetchRaw).not.toHaveBeenCalled();
    expect(failed).toEqual([{ id: 'r1', code: 'POSITION_CHANGED' }]);
    expect(summary).toEqual({ ready: 0, failed: 1, unexpected: 0 });
  });

  it('un mensaje truncado no se analiza y cierra con TOO_LARGE', async () => {
    const { useCase, failed, parse } = buildHarness({
      pending: [pendingRequest('r1', 10)],
      raw: { bytes: new Uint8Array([1]), truncated: true },
    });

    await useCase.execute(SOURCE);

    expect(parse).not.toHaveBeenCalled();
    expect(failed).toEqual([{ id: 'r1', code: 'TOO_LARGE' }]);
  });

  it('un cuerpo mayor al tope se rechaza entero, sin truncarlo', async () => {
    const { useCase, failed, completed } = buildHarness({
      pending: [pendingRequest('r1', 10, 'body')],
      parsed: parsedMail({ bodyText: 'a'.repeat(64 * 1024 + 1) }),
    });

    await useCase.execute(SOURCE);

    expect(completed).toEqual([]);
    expect(failed).toEqual([{ id: 'r1', code: 'TOO_LARGE' }]);
  });

  it('un asunto vacío o solo de controles cierra con EMPTY', async () => {
    const { useCase, failed } = buildHarness({
      pending: [pendingRequest('r1', 10)],
      parsed: parsedMail({ subject: '\u202e \u0007' }),
    });

    await useCase.execute(SOURCE);

    expect(failed).toEqual([{ id: 'r1', code: 'EMPTY' }]);
  });

  it.each([
    ['un UID que el servidor no entrega', new MessageFetchError(), 'NOT_FOUND'],
    ['un mensaje que no se puede analizar', new MimeParseError(), 'UNREADABLE'],
    ['un fallo de conexión al descargar', new MailboxConnectionError('TIMEOUT'), 'CONNECTION'],
  ] as const)('%s cierra como %s y sigue con el siguiente', async (_label, error, expected) => {
    const { useCase, failed, completed } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      raw: error,
    });

    const summary = await useCase.execute(SOURCE);

    expect(failed).toEqual([
      { id: 'r1', code: expected },
      { id: 'r2', code: expected },
    ]);
    expect(completed).toEqual([]);
    expect(summary).toEqual({ ready: 0, failed: 2, unexpected: 0 });
  });

  it('un defecto cierra con UNEXPECTED, deja lo demás pendiente y cierra la sesión', async () => {
    const { useCase, failed, fetchRaw, sessionClose } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      raw: new Error('boom'),
    });

    const summary = await useCase.execute(SOURCE);

    expect(failed).toEqual([{ id: 'r1', code: 'UNEXPECTED' }]);
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ ready: 0, failed: 1, unexpected: 1 });
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it('un fallo de conexión al abrir cierra todo como CONNECTION', async () => {
    const { useCase, failed } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      openError: new MailboxConnectionError('AUTH'),
    });

    await useCase.execute(SOURCE);

    expect(failed).toEqual([
      { id: 'r1', code: 'CONNECTION' },
      { id: 'r2', code: 'CONNECTION' },
    ]);
  });

  it('una excepción desconocida al abrir cierra como UNEXPECTED y la cuenta', async () => {
    const { useCase, failed } = buildHarness({
      pending: [pendingRequest('r1', 10)],
      openError: new Error('boom'),
    });

    const summary = await useCase.execute(SOURCE);

    expect(failed).toEqual([{ id: 'r1', code: 'UNEXPECTED' }]);
    expect(summary.unexpected).toBe(1);
  });

  it.each([
    ['CONNECTION_MISSING', 'CONNECTION_MISSING'],
    ['PASSWORD_MISSING', 'CONNECTION_MISSING'],
    ['PASSWORD_UNREADABLE', 'CONNECTION'],
    ['KMS_UNAVAILABLE', 'CONNECTION'],
  ] as const)(
    'si la conexión no carga (%s) cierra como %s sin abrir el buzón',
    async (failure, expected) => {
      const { useCase, failed, open } = buildHarness({
        pending: [pendingRequest('r1', 10)],
        load: { ok: false, code: failure },
      });

      await useCase.execute(SOURCE);

      expect(failed).toEqual([{ id: 'r1', code: expected }]);
      expect(open).not.toHaveBeenCalled();
    },
  );
});

describe('RunMailPreviewRequests', () => {
  const buildWork = (
    pending: readonly (typeof SOURCE)[],
    expired: readonly (typeof SOURCE)[] = [],
    purgeExpired = vi.fn(() => Promise.resolve(0)),
  ) => ({
    listSourcesWithPending: vi.fn(() => Promise.resolve(pending)),
    listSourcesWithExpired: vi.fn(() => Promise.resolve(expired)),
    purgeExpired,
  });

  it('suma los resultados de cada fuente', async () => {
    const executor = {
      execute: vi.fn(() => Promise.resolve({ ready: 2, failed: 1, unexpected: 0 })),
    };
    const runner = new RunMailPreviewRequests({
      work: buildWork([SOURCE, { ...SOURCE, sourceId: 's2' }]),
      executor,
      clock: { now: () => NOW },
    });

    expect(await runner.execute()).toEqual({
      sources: 2,
      purged: 0,
      ready: 4,
      failed: 2,
      unexpected: 0,
    });
  });

  it('una fuente que lanza no detiene a las demás y se cuenta como inesperada', async () => {
    const executor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ ready: 1, failed: 0, unexpected: 0 }),
    };
    const runner = new RunMailPreviewRequests({
      work: buildWork([SOURCE, { ...SOURCE, sourceId: 's2' }]),
      executor,
      clock: { now: () => NOW },
    });

    expect(await runner.execute()).toEqual({
      sources: 2,
      purged: 0,
      ready: 1,
      failed: 0,
      unexpected: 1,
    });
  });

  it('purga lo vencido también de una fuente que ya no está entre las activas, sin abrir el buzón', async () => {
    const suspended = { ...SOURCE, sourceId: 'suspended' };
    const purgeExpired = vi.fn(() => Promise.resolve(3));
    const executor = { execute: vi.fn() };
    const runner = new RunMailPreviewRequests({
      work: buildWork([], [suspended], purgeExpired),
      executor,
      clock: { now: () => NOW },
    });

    const summary = await runner.execute();

    expect(purgeExpired).toHaveBeenCalledWith(suspended, NOW);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary.purged).toBe(3);
  });

  it('un fallo al purgar una fuente no impide atender las pendientes', async () => {
    const purgeExpired = vi.fn(() => Promise.reject(new Error('boom')));
    const executor = {
      execute: vi.fn(() => Promise.resolve({ ready: 1, failed: 0, unexpected: 0 })),
    };
    const runner = new RunMailPreviewRequests({
      work: buildWork([SOURCE], [SOURCE], purgeExpired),
      executor,
      clock: { now: () => NOW },
    });

    expect(await runner.execute()).toEqual({
      sources: 1,
      purged: 0,
      ready: 1,
      failed: 0,
      unexpected: 1,
    });
  });
});
