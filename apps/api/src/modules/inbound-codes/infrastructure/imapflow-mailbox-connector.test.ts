import { describe, expect, it } from 'vitest';

import type { MailConnection } from '../application/ports/mail-connection-loader.js';
import { MailboxConnectionError, MessageFetchError } from '../application/ports/mailbox.js';
import {
  ImapFlowMailboxConnector,
  classifyImapError,
  type ImapClient,
  type ImapClientSettings,
  type ImapFetchedSummary,
} from './imapflow-mailbox-connector.js';
import { NetworkGuard } from './network-guard.js';

const CONNECTION: MailConnection = {
  host: 'imap.example.test',
  port: 993,
  username: 'codes@example.test',
  password: 'contrasena-de-prueba',
  tlsMode: 'tls',
  authservId: 'mx.example.test',
  sourceAddress: 'codes@example.test',
  acceptedRecipients: [],
};

interface FakeClientBehavior {
  connectError?: unknown;
  lockError?: unknown;
  mailbox?: { uidValidity: bigint } | false;
  searchResult?: number[] | false;
  searchError?: unknown;
  messages?: ImapFetchedSummary[];
  source?: Uint8Array | false | undefined;
  fetchOneError?: unknown;
  logoutError?: unknown;
}

/** La biblioteca real rechaza con objetos que no son `Error`; la prueba reproduce esa forma. */
function rejectWith(reason: unknown): Promise<never> {
  return Promise.reject(reason instanceof Error ? reason : (reason as Error));
}

function fakeEnvironment(
  behavior: FakeClientBehavior = {},
  addresses: readonly string[] = ['8.8.8.8'],
) {
  const calls: string[] = [];
  const state = {
    settings: null as ImapClientSettings | null,
    errorListenerCount: 0,
    lockOptions: null as { readOnly: boolean } | null,
    searchQuery: null as { uid: string; since: Date } | null,
    fetchRange: null as string | null,
    fetchOneQuery: null as { source: { maxLength: number } } | null,
  };
  const client: ImapClient = {
    on: () => {
      state.errorListenerCount += 1;
    },
    connect: () => {
      calls.push('connect');
      return behavior.connectError === undefined
        ? Promise.resolve()
        : rejectWith(behavior.connectError);
    },
    getMailboxLock: (_path, options) => {
      state.lockOptions = options;
      calls.push('lock');
      if (behavior.lockError !== undefined) return rejectWith(behavior.lockError);
      return Promise.resolve({ release: () => calls.push('release') });
    },
    get mailbox() {
      return behavior.mailbox ?? { uidValidity: 7n };
    },
    search: (query) => {
      state.searchQuery = query;
      if (behavior.searchError !== undefined) return rejectWith(behavior.searchError);
      return Promise.resolve(behavior.searchResult ?? []);
    },
    fetch: (range) => {
      state.fetchRange = range;
      const messages = behavior.messages ?? [];
      return (async function* () {
        await Promise.resolve();
        for (const message of messages) yield message;
      })();
    },
    fetchOne: (_range, query) => {
      state.fetchOneQuery = query;
      if (behavior.fetchOneError !== undefined) return rejectWith(behavior.fetchOneError);
      const source = 'source' in behavior ? behavior.source : new Uint8Array([1, 2, 3]);
      return Promise.resolve(source === false || source === undefined ? false : { source });
    },
    logout: () => {
      calls.push('logout');
      return behavior.logoutError === undefined
        ? Promise.resolve()
        : rejectWith(behavior.logoutError);
    },
    close: () => {
      calls.push('close');
    },
  };
  const guard = new NetworkGuard(() => Promise.resolve(addresses));
  const connector = new ImapFlowMailboxConnector(guard, (settings) => {
    state.settings = settings;
    return client;
  });
  return { connector, calls, state };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MailboxConnectionError) return error.code;
    return `other:${String(error)}`;
  }
  return 'no-error';
}

describe('ImapFlowMailboxConnector.open', () => {
  it('connects to the validated IP while keeping the host name for certificate verification', async () => {
    const { connector, state } = fakeEnvironment();

    await connector.open(CONNECTION);

    expect(state.settings).toMatchObject({
      host: '8.8.8.8',
      servername: 'imap.example.test',
      port: 993,
      secure: true,
      doSTARTTLS: false,
    });
  });

  it('forces the TLS upgrade for STARTTLS instead of allowing cleartext', async () => {
    const { connector, state } = fakeEnvironment();

    await connector.open({ ...CONNECTION, port: 143, tlsMode: 'starttls' });

    expect(state.settings).toMatchObject({ secure: false, doSTARTTLS: true });
  });

  it('sends no SNI name when the configured host is an IP literal', async () => {
    const { connector, state } = fakeEnvironment();

    await connector.open({ ...CONNECTION, host: '8.8.4.4' });

    expect(state.settings?.servername).toBeUndefined();
    expect(state.settings?.host).toBe('8.8.4.4');
  });

  it('rejects a host that resolves to a non-public address without creating a client', async () => {
    const { connector, state } = fakeEnvironment({}, ['169.254.169.254']);

    await expect(codeOf(connector.open(CONNECTION))).resolves.toBe('HOST_REJECTED');
    expect(state.settings).toBeNull();
  });

  it('registers an error listener before connecting', async () => {
    const { connector, state } = fakeEnvironment();

    await connector.open(CONNECTION);

    expect(state.errorListenerCount).toBe(1);
  });

  it('opens the mailbox read-only and exposes UIDVALIDITY as a number', async () => {
    const { connector, state } = fakeEnvironment({ mailbox: { uidValidity: 4242n } });

    const session = await connector.open(CONNECTION);

    expect(state.lockOptions).toEqual({ readOnly: true });
    expect(session.uidValidity).toBe(4242);
  });

  it.each([
    [{ authenticationFailed: true, code: 'AUTHENTICATIONFAILED' }, 'AUTH'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'TLS'],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'TLS'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
    [{ code: 'CONNECT_TIMEOUT' }, 'TIMEOUT'],
    [{ code: 'GREETING_TIMEOUT' }, 'TIMEOUT'],
    [{ code: 'UPGRADE_TIMEOUT' }, 'TIMEOUT'],
    [{ tlsFailed: true }, 'TLS'],
    [Object.assign(new Error('el servidor no ofrece STARTTLS'), { tlsFailed: true }), 'TLS'],
    [{ code: 'STARTTLS_INJECTION', tlsFailed: true }, 'TLS'],
    [{ code: 'STARTTLS_INJECTION' }, 'TLS'],
    [{ code: 'ECONNREFUSED' }, 'NETWORK'],
    [new Error('detalle interno del servidor con secretos'), 'NETWORK'],
    ['texto suelto', 'NETWORK'],
    [null, 'NETWORK'],
  ])('maps the connect failure %j to the bounded code %s', async (failure, expectedCode) => {
    const { connector, calls } = fakeEnvironment({ connectError: failure });

    await expect(codeOf(connector.open(CONNECTION))).resolves.toBe(expectedCode);
    expect(calls).toContain('close');
  });

  it('never leaks the server text in the error message', async () => {
    const { connector } = fakeEnvironment({
      connectError: Object.assign(new Error('LOGIN secreto fallo'), { code: 'ECONNRESET' }),
    });

    const error = await connector.open(CONNECTION).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailboxConnectionError);
    expect((error as Error).message).toBe('NETWORK');
    expect(String(error)).not.toContain('secreto');
  });

  it('reports the mailbox as unavailable and closes when the lock fails', async () => {
    const { connector, calls } = fakeEnvironment({ lockError: new Error('NO such mailbox') });

    await expect(codeOf(connector.open(CONNECTION))).resolves.toBe('MAILBOX_UNAVAILABLE');
    expect(calls).toContain('close');
  });

  it('releases the lock and closes when no mailbox ended up selected', async () => {
    const { connector, calls } = fakeEnvironment({ mailbox: false });

    await expect(codeOf(connector.open(CONNECTION))).resolves.toBe('MAILBOX_UNAVAILABLE');
    expect(calls).toEqual(['connect', 'lock', 'release', 'close']);
  });
});

describe('ImapFlowMailboxSession.list', () => {
  const SINCE = new Date('2026-11-02T10:00:00Z');

  it('searches above the cursor since the window start and asks metadata newest first', async () => {
    const { connector, state } = fakeEnvironment({
      searchResult: [11, 13, 12],
      messages: [
        {
          uid: 13,
          size: 900,
          internalDate: new Date('2026-11-02T10:05:00Z'),
          envelope: { from: [{ address: 'Alertas@Banco.Test' }] },
        },
      ],
    });
    const session = await connector.open(CONNECTION);

    const listed = await session.list(10, SINCE);

    expect(state.searchQuery).toEqual({ uid: '11:*', since: SINCE });
    expect(state.fetchRange).toBe('13,12,11');
    expect(listed).toEqual([
      {
        uid: 13,
        sizeBytes: 900,
        internalDate: new Date('2026-11-02T10:05:00Z'),
        envelopeFromAddress: 'alertas@banco.test',
      },
    ]);
  });

  it('drops the last message that "N:*" returns even when its UID is not above the cursor', async () => {
    const { connector, state } = fakeEnvironment({
      searchResult: [5],
      messages: [{ uid: 5, size: 1, internalDate: new Date('2026-11-02T10:05:00Z') }],
    });
    const session = await connector.open(CONNECTION);

    await expect(session.list(10, SINCE)).resolves.toEqual([]);
    expect(state.fetchRange).toBeNull();
  });

  it('skips a message whose internal date cannot be read and keeps a missing sender as null', async () => {
    const { connector } = fakeEnvironment({
      searchResult: [21, 22],
      messages: [
        { uid: 22, size: 3, internalDate: 'no es una fecha' },
        { uid: 21, size: 3, internalDate: '2026-11-02T10:06:00Z' },
      ],
    });
    const session = await connector.open(CONNECTION);

    const listed = await session.list(20, SINCE);

    expect(listed.map((message) => message.uid)).toEqual([21]);
    expect(listed[0]?.envelopeFromAddress).toBeNull();
  });

  it('returns nothing when the server answers the search with false', async () => {
    const { connector } = fakeEnvironment({ searchResult: false });
    const session = await connector.open(CONNECTION);

    await expect(session.list(0, SINCE)).resolves.toEqual([]);
  });

  it('caps how many messages it asks metadata for, keeping the newest', async () => {
    const uids = Array.from({ length: 600 }, (_unused, index) => index + 1);
    const { connector, state } = fakeEnvironment({ searchResult: uids });
    const session = await connector.open(CONNECTION);

    await session.list(0, SINCE);

    const requested = (state.fetchRange ?? '').split(',').map(Number);
    expect(requested).toHaveLength(500);
    expect(requested[0]).toBe(600);
  });

  it('turns a search failure into a bounded connection error', async () => {
    const { connector } = fakeEnvironment({ searchError: { code: 'ETIMEDOUT' } });
    const session = await connector.open(CONNECTION);

    await expect(codeOf(session.list(0, SINCE))).resolves.toBe('TIMEOUT');
  });
});

describe('ImapFlowMailboxSession.fetchRaw', () => {
  it('asks for one byte more than the cap and returns the message whole when it fits', async () => {
    const { connector, state } = fakeEnvironment({ source: new Uint8Array([1, 2, 3]) });
    const session = await connector.open(CONNECTION);

    const raw = await session.fetchRaw(5, 10);

    expect(state.fetchOneQuery?.source.maxLength).toBe(11);
    expect(raw.truncated).toBe(false);
    expect([...raw.bytes]).toEqual([1, 2, 3]);
  });

  it('marks as truncated and cuts to the cap a message that reaches the extra byte', async () => {
    const { connector } = fakeEnvironment({ source: new Uint8Array(11).fill(7) });
    const session = await connector.open(CONNECTION);

    const raw = await session.fetchRaw(5, 10);

    expect(raw.truncated).toBe(true);
    expect(raw.bytes.length).toBe(10);
  });

  it('accepts a message of exactly the cap as complete', async () => {
    const { connector } = fakeEnvironment({ source: new Uint8Array(10).fill(7) });
    const session = await connector.open(CONNECTION);

    await expect(session.fetchRaw(5, 10)).resolves.toMatchObject({ truncated: false });
  });

  it('reports a missing message or an empty source as a per-message failure', async () => {
    const missing = await fakeEnvironment({ source: false }).connector.open(CONNECTION);
    await expect(missing.fetchRaw(5, 10)).rejects.toBeInstanceOf(MessageFetchError);

    const empty = await fakeEnvironment({ source: undefined }).connector.open(CONNECTION);
    await expect(empty.fetchRaw(5, 10)).rejects.toBeInstanceOf(MessageFetchError);
  });

  it('treats a protocol error on one message as that message failing, not the connection', async () => {
    const { connector } = fakeEnvironment({ fetchOneError: new Error('BAD parse') });
    const session = await connector.open(CONNECTION);

    await expect(session.fetchRaw(5, 10)).rejects.toBeInstanceOf(MessageFetchError);
  });

  it.each([
    ['ECONNRESET', 'NETWORK'],
    ['EConnectionClosed', 'NETWORK'],
    ['NoConnection', 'NETWORK'],
    ['ClosedAfterConnectTLS', 'NETWORK'],
    ['ClosedAfterConnectText', 'NETWORK'],
    ['StateLogout', 'NETWORK'],
    ['EHOSTUNREACH', 'NETWORK'],
    ['ENETUNREACH', 'NETWORK'],
    ['ECONNABORTED', 'NETWORK'],
    ['GREETING_TIMEOUT', 'TIMEOUT'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['STARTTLS_INJECTION', 'TLS'],
    ['CERT_HAS_EXPIRED', 'TLS'],
  ])(
    'treats the dead-session error %s as a connection failure, never as one bad message',
    async (code, expectedCode) => {
      const { connector } = fakeEnvironment({ fetchOneError: { code } });
      const session = await connector.open(CONNECTION);

      await expect(codeOf(session.fetchRaw(5, 10))).resolves.toBe(expectedCode);
    },
  );

  it('treats a failed TLS upgrade flag as a connection failure while fetching', async () => {
    const { connector } = fakeEnvironment({ fetchOneError: { tlsFailed: true } });
    const session = await connector.open(CONNECTION);

    await expect(codeOf(session.fetchRaw(5, 10))).resolves.toBe('TLS');
  });
});

describe('ImapFlowMailboxSession.close', () => {
  it('releases the lock and logs out', async () => {
    const { connector, calls } = fakeEnvironment();
    const session = await connector.open(CONNECTION);

    await session.close();

    expect(calls.slice(-2)).toEqual(['release', 'logout']);
  });

  it('closes the socket when releasing the lock throws', async () => {
    const { connector, calls } = fakeEnvironment();
    const session = await connector.open(CONNECTION);
    // La liberación del candado falla: el socket igual debe cortarse.
    Object.defineProperty(session, 'lock', {
      value: {
        release: () => {
          throw new Error('candado');
        },
      },
    });

    await expect(session.close()).resolves.toBeUndefined();
    expect(calls.at(-1)).toBe('close');
  });

  it('closes the socket when logout fails instead of throwing', async () => {
    const { connector, calls } = fakeEnvironment({ logoutError: new Error('cerrado') });
    const session = await connector.open(CONNECTION);

    await expect(session.close()).resolves.toBeUndefined();
    expect(calls.at(-1)).toBe('close');
  });
});

describe('classifyImapError', () => {
  it('keeps the code of an error that is already bounded', () => {
    expect(classifyImapError(new MailboxConnectionError('TLS'))).toBe('TLS');
  });
});
