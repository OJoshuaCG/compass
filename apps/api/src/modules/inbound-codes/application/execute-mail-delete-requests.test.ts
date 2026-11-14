import { describe, expect, it, vi } from 'vitest';

import { asOrganizationId } from '../../../shared/kernel/index.js';
import {
  ExecuteMailDeleteRequests,
  MAX_MAIL_DELETES_PER_SOURCE,
} from './execute-mail-delete-requests.js';
import type { MailConnectionLoadResult } from './ports/mail-connection-loader.js';
import {
  MAIL_DELETE_REQUEST_TTL_MS,
  type MailDeleteResultCode,
  type PendingMailDelete,
} from './ports/mail-delete-work-store.js';
import { MailboxConnectionError, MailboxDeleteUnsupportedError } from './ports/mailbox.js';
import type { MailboxDeleteOutcome } from './ports/mailbox.js';
import { RunMailDeleteRequests } from './run-mail-delete-requests.js';

const SOURCE = {
  organizationId: asOrganizationId('0198dddd-0000-7000-8000-000000000001'),
  sourceId: 's1',
};
const NOW = new Date('2026-11-14T12:00:00Z');
const MAILBOX_UID_VALIDITY = 77;

const pendingRequest = (
  id: string,
  uid: number,
  uidValidity = MAILBOX_UID_VALIDITY,
): PendingMailDelete => ({
  requestId: id,
  mailboxUidValidity: uidValidity,
  mailboxUid: uid,
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
  readonly pending?: readonly PendingMailDelete[];
  readonly load?: MailConnectionLoadResult;
  readonly openError?: Error;
  readonly sessionUidValidity?: number;
  readonly outcomes?: Readonly<Record<number, MailboxDeleteOutcome | Error>>;
}

function buildHarness(options: HarnessOptions = {}) {
  const closed: { id: string; code: MailDeleteResultCode }[] = [];
  const listPending = vi.fn(() => Promise.resolve(options.pending ?? []));
  const close = vi.fn((_source: unknown, id: string, code: MailDeleteResultCode) => {
    closed.push({ id, code });
    return Promise.resolve();
  });
  const deleteMessage = vi.fn((uid: number) => {
    const outcome = options.outcomes?.[uid] ?? 'deleted';
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
  const sessionClose = vi.fn(() => Promise.resolve());
  const load = vi.fn(() => Promise.resolve(options.load ?? LOADED));
  const openForWrite = vi.fn(() =>
    options.openError === undefined
      ? Promise.resolve({
          uidValidity: options.sessionUidValidity ?? MAILBOX_UID_VALIDITY,
          deleteMessage,
          close: sessionClose,
        })
      : Promise.reject(options.openError),
  );
  const useCase = new ExecuteMailDeleteRequests({
    work: {
      listSourcesWithPending: vi.fn(),
      listSourcesWithStale: vi.fn(),
      expireStale: vi.fn(),
      listPending,
      close,
    },
    connections: { load },
    mailbox: { openForWrite },
    clock: { now: () => NOW },
  });
  return { useCase, closed, listPending, load, openForWrite, deleteMessage, sessionClose };
}

describe('ExecuteMailDeleteRequests', () => {
  it('sin pendientes no carga la conexión ni abre el buzón', async () => {
    const { useCase, load, openForWrite } = buildHarness({ pending: [] });

    const summary = await useCase.execute(SOURCE);

    expect(summary).toEqual({ deleted: 0, failed: 0, unexpected: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(openForWrite).not.toHaveBeenCalled();
  });

  it('pide a lo más el tope de pendientes por pasada', async () => {
    const { useCase, listPending } = buildHarness();

    await useCase.execute(SOURCE);

    expect(listPending).toHaveBeenCalledWith(SOURCE, MAX_MAIL_DELETES_PER_SOURCE, expect.any(Date));
  });

  it('solo pide las peticiones de las últimas 24 horas', async () => {
    const { useCase, listPending } = buildHarness();

    await useCase.execute(SOURCE);

    const notBefore = (listPending.mock.calls[0] as unknown as [unknown, number, Date])[2];
    expect(notBefore.getTime()).toBe(NOW.getTime() - MAIL_DELETE_REQUEST_TTL_MS);
    expect(MAIL_DELETE_REQUEST_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('borra por UID y cierra con DELETED solo cuando el servidor lo confirmó', async () => {
    const { useCase, closed, deleteMessage, sessionClose } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
    });

    const summary = await useCase.execute(SOURCE);

    expect(deleteMessage.mock.calls).toEqual([[10], [11]]);
    expect(closed).toEqual([
      { id: 'r1', code: 'DELETED' },
      { id: 'r2', code: 'DELETED' },
    ]);
    expect(summary).toEqual({ deleted: 2, failed: 0, unexpected: 0 });
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it('si el UIDVALIDITY cambió NO borra nada y cierra con POSITION_CHANGED', async () => {
    const { useCase, closed, deleteMessage } = buildHarness({
      pending: [pendingRequest('r1', 10, 76)],
    });

    const summary = await useCase.execute(SOURCE);

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(closed).toEqual([{ id: 'r1', code: 'POSITION_CHANGED' }]);
    expect(summary).toEqual({ deleted: 0, failed: 1, unexpected: 0 });
  });

  it('un UID que el servidor no encuentra se cierra como NOT_FOUND y sigue con el siguiente', async () => {
    const { useCase, closed } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      outcomes: { 10: 'not_deleted' },
    });

    const summary = await useCase.execute(SOURCE);

    expect(closed).toEqual([
      { id: 'r1', code: 'NOT_FOUND' },
      { id: 'r2', code: 'DELETED' },
    ]);
    expect(summary).toEqual({ deleted: 1, failed: 1, unexpected: 0 });
  });

  it('un defecto al borrar cierra con UNEXPECTED, deja lo demás pendiente y cierra la sesión', async () => {
    const { useCase, closed, deleteMessage, sessionClose } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      outcomes: { 10: new Error('boom') },
    });

    const summary = await useCase.execute(SOURCE);

    expect(closed).toEqual([{ id: 'r1', code: 'UNEXPECTED' }]);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ deleted: 0, failed: 1, unexpected: 1 });
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it('sin UIDPLUS en el servidor cierra todo como UNSUPPORTED sin borrar', async () => {
    const { useCase, closed } = buildHarness({
      pending: [pendingRequest('r1', 10), pendingRequest('r2', 11)],
      openError: new MailboxDeleteUnsupportedError(),
    });

    const summary = await useCase.execute(SOURCE);

    expect(closed).toEqual([
      { id: 'r1', code: 'UNSUPPORTED' },
      { id: 'r2', code: 'UNSUPPORTED' },
    ]);
    expect(summary).toEqual({ deleted: 0, failed: 2, unexpected: 0 });
  });

  it('un fallo de conexión al abrir cierra todo como CONNECTION', async () => {
    const { useCase, closed } = buildHarness({
      pending: [pendingRequest('r1', 10)],
      openError: new MailboxConnectionError('AUTH'),
    });

    await useCase.execute(SOURCE);

    expect(closed).toEqual([{ id: 'r1', code: 'CONNECTION' }]);
  });

  it('una excepción desconocida al abrir cierra como UNEXPECTED y la cuenta', async () => {
    const { useCase, closed } = buildHarness({
      pending: [pendingRequest('r1', 10)],
      openError: new Error('boom'),
    });

    const summary = await useCase.execute(SOURCE);

    expect(closed).toEqual([{ id: 'r1', code: 'UNEXPECTED' }]);
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
      const { useCase, closed, openForWrite } = buildHarness({
        pending: [pendingRequest('r1', 10)],
        load: { ok: false, code: failure },
      });

      await useCase.execute(SOURCE);

      expect(closed).toEqual([{ id: 'r1', code: expected }]);
      expect(openForWrite).not.toHaveBeenCalled();
    },
  );
});

describe('RunMailDeleteRequests', () => {
  const listSourcesWith = (
    sources: readonly (typeof SOURCE)[],
    stale: readonly (typeof SOURCE)[] = [],
    expireStale = vi.fn(() => Promise.resolve(0)),
  ) => ({
    listSourcesWithPending: () => Promise.resolve(sources),
    listSourcesWithStale: vi.fn(() => Promise.resolve(stale)),
    expireStale,
  });

  it('suma los resultados de cada fuente', async () => {
    const executor = {
      execute: vi.fn(() => Promise.resolve({ deleted: 2, failed: 1, unexpected: 0 })),
    };
    const runner = new RunMailDeleteRequests({
      work: listSourcesWith([SOURCE, { ...SOURCE, sourceId: 's2' }]),
      executor,
      clock: { now: () => NOW },
    });

    expect(await runner.execute()).toEqual({ sources: 2, deleted: 4, failed: 2, unexpected: 0 });
  });

  it('una fuente que lanza no detiene a las demás y se cuenta como inesperada', async () => {
    const executor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ deleted: 1, failed: 0, unexpected: 0 }),
    };
    const runner = new RunMailDeleteRequests({
      work: listSourcesWith([SOURCE, { ...SOURCE, sourceId: 's2' }]),
      executor,
      clock: { now: () => NOW },
    });

    expect(await runner.execute()).toEqual({ sources: 2, deleted: 1, failed: 0, unexpected: 1 });
  });

  it('cierra como vencidas las peticiones de una fuente aunque no esté entre las activas, sin abrir el buzón', async () => {
    const suspended = { ...SOURCE, sourceId: 'suspended' };
    const expireStale = vi.fn(() => Promise.resolve(3));
    const executor = { execute: vi.fn() };
    const runner = new RunMailDeleteRequests({
      work: listSourcesWith([], [suspended], expireStale),
      executor,
      clock: { now: () => NOW },
    });

    const summary = await runner.execute();

    const cutoff = new Date(NOW.getTime() - MAIL_DELETE_REQUEST_TTL_MS);
    expect(expireStale).toHaveBeenCalledWith(suspended, cutoff, NOW);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary).toEqual({ sources: 0, deleted: 0, failed: 3, unexpected: 0 });
  });
});
