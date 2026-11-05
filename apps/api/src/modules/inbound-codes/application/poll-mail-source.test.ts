import { beforeEach, describe, expect, it } from 'vitest';

import {
  FIXTURE_ALIAS,
  FIXTURE_CODE,
  FIXTURE_NOW,
  buildLoginCodeTemplate,
} from '../testing/mail-fixtures.js';
import {
  FakeAuthenticityVerifier,
  FakeClock,
  FakeConnectionLoader,
  FakeFingerprinter,
  FakeMailboxConnector,
  FakeMailboxSession,
  FakeMimeParser,
  FakeObserver,
  FakePollStateStore,
  FakeRecorder,
  FakeTemplateStore,
  POLL_SOURCE,
  POLL_UID_VALIDITY,
  buildConnection,
  buildMailboxMessage,
  buildParsedMail,
} from '../testing/poll-fakes.js';
import {
  POLL_BACKOFF_CAP_MS,
  POLL_LEASE_MS,
  POLL_MAX_MESSAGES_PER_PASS,
  POLL_MAX_MESSAGE_BYTES,
  POLL_MESSAGE_WINDOW_MS,
  POLL_SOURCE_BUDGET_MS,
  computeWindowStart,
} from '../domain/poll-policy.js';
import { PollMailSource } from './poll-mail-source.js';
import { MailboxConnectionError, MessageFetchError } from './ports/mailbox.js';
import { MimeParseError } from './ports/mime-and-authenticity.js';

const ONE_MINUTE_MS = 60 * 1000;

// SENSIBLE (revisión humana)
describe('PollMailSource', () => {
  let state: FakePollStateStore;
  let connections: FakeConnectionLoader;
  let templates: FakeTemplateStore;
  let session: FakeMailboxSession;
  let connector: FakeMailboxConnector;
  let mime: FakeMimeParser;
  let authenticity: FakeAuthenticityVerifier;
  let recorder: FakeRecorder;
  let observer: FakeObserver;
  let clock: FakeClock;

  function buildUseCase(): PollMailSource {
    return new PollMailSource({
      state,
      connections,
      templates,
      mailbox: connector,
      mime,
      authenticity,
      fingerprints: new FakeFingerprinter(),
      recorder,
      clock,
      observer,
    });
  }

  beforeEach(() => {
    state = new FakePollStateStore();
    connections = new FakeConnectionLoader();
    templates = new FakeTemplateStore();
    session = new FakeMailboxSession();
    connector = new FakeMailboxConnector(session);
    mime = new FakeMimeParser();
    authenticity = new FakeAuthenticityVerifier();
    recorder = new FakeRecorder();
    observer = new FakeObserver();
    clock = new FakeClock();
  });

  describe('lease', () => {
    it('does nothing when another pass holds the source', async () => {
      state.cursor = null;

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toEqual({ status: 'skipped_leased' });
      expect(connections.loadCalls).toBe(0);
      expect(connector.openCalls).toBe(0);
      expect(state.calls).toEqual(['claim']);
    });

    it('releases the lease exactly once on success and never records a failure', async () => {
      session.messages = [buildMailboxMessage(1)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(state.successReleases).toBe(1);
      expect(state.failureReleases).toEqual([]);
      expect(state.calls.at(-1)).toBe('releaseAfterSuccess');
    });
  });

  describe('connection failures', () => {
    it('keeps the cursor, closes nothing it never opened and backs off one minute on the first failure', async () => {
      connector.openError = new MailboxConnectionError('AUTH');

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toEqual({ status: 'failed', errorCode: 'AUTH' });
      expect(state.savedCursors).toEqual([]);
      expect(state.successReleases).toBe(0);
      expect(state.failureReleases).toHaveLength(1);
      expect(state.failureReleases[0]?.errorCode).toBe('AUTH');
      expect(state.failureReleases[0]?.nextAttemptAt).toEqual(
        new Date(FIXTURE_NOW.getTime() + ONE_MINUTE_MS),
      );
    });

    it('doubles the backoff with consecutive failures and caps it at one hour', async () => {
      connector.openError = new MailboxConnectionError('NETWORK');

      state.cursor = { uidValidity: null, lastUid: 0, consecutiveFailures: 2 };
      await buildUseCase().execute(POLL_SOURCE);
      state.cursor = { uidValidity: null, lastUid: 0, consecutiveFailures: 50 };
      await buildUseCase().execute(POLL_SOURCE);

      expect(state.failureReleases[0]?.nextAttemptAt).toEqual(
        new Date(FIXTURE_NOW.getTime() + 4 * ONE_MINUTE_MS),
      );
      expect(state.failureReleases[1]?.nextAttemptAt).toEqual(
        new Date(FIXTURE_NOW.getTime() + POLL_BACKOFF_CAP_MS),
      );
    });

    it('reports a connection that cannot be loaded with its bounded code', async () => {
      connections.result = { ok: false, code: 'KMS_UNAVAILABLE' };

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toEqual({ status: 'failed', errorCode: 'KMS_UNAVAILABLE' });
      expect(connector.openCalls).toBe(0);
      expect(state.failureReleases[0]?.errorCode).toBe('KMS_UNAVAILABLE');
    });

    it('aborts without advancing the cursor when the connection drops while fetching', async () => {
      session.messages = [buildMailboxMessage(2), buildMailboxMessage(1)];
      session.fetchFailures.set(1, new MailboxConnectionError('NETWORK'));

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toEqual({ status: 'failed', errorCode: 'NETWORK' });
      // Lo ya registrado queda (es idempotente); el cursor no se mueve.
      expect(recorder.accepted).toHaveLength(1);
      expect(state.savedCursors).toEqual([]);
      expect(session.closeCalls).toBe(1);
    });

    it('turns an unexpected error into a generic code and still releases the lease', async () => {
      session.messages = [buildMailboxMessage(1)];
      recorder.writeError = new Error('detalle interno que no debe salir');

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toEqual({ status: 'failed', errorCode: 'UNEXPECTED' });
      expect(JSON.stringify(result)).not.toContain('detalle interno');
      expect(state.failureReleases).toHaveLength(1);
      expect(state.savedCursors).toEqual([]);
    });

    it('always closes the session and ignores a failing close', async () => {
      session.messages = [buildMailboxMessage(1)];
      session.closeError = new Error('close failed');

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result.status).toBe('completed');
      expect(session.closeCalls).toBe(1);
    });
  });

  describe('a message that is accepted', () => {
    it('records the encrypted-to-be item data, advances the cursor and logs without sensitive fields', async () => {
      session.messages = [buildMailboxMessage(5)];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result.status).toBe('completed');
      expect(recorder.accepted).toEqual([
        {
          fingerprint: 'raw:00aa:msg-5',
          receivedAt: new Date(FIXTURE_NOW.getTime() - 30 * 1000),
          templateId: 'facebook-login-code',
          kind: 'login_code',
          visibility: 'visible_with_use',
          valueType: 'code',
          value: FIXTURE_CODE,
          // min(fecha firmada 11:59:40, recepción 11:59:30) + 10 minutos.
          expiresAt: new Date('2026-10-30T12:09:30.000Z'),
          signingDomain: 'facebook.com',
        },
      ]);
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 5 }]);
      expect(observer.records).toEqual([
        {
          sourceId: POLL_SOURCE.sourceId,
          fingerprint: 'raw:00aa:msg-5',
          outcome: 'accepted',
          reason: null,
          verdicts: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
        },
      ]);
      expect(JSON.stringify(observer.records)).not.toContain(FIXTURE_CODE);
    });

    it('passes the configured authserv-id and accepted recipients through to the checks', async () => {
      const forwardedTo = 'original@dominio.example';
      connections.result = {
        ok: true,
        connection: buildConnection({
          authservId: 'mx.propio.example',
          acceptedRecipients: [FIXTURE_ALIAS, forwardedTo],
        }),
      };
      mime.perMessage.set('msg-9', buildParsedMail({ toAddresses: [forwardedTo] }));
      session.messages = [buildMailboxMessage(9)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(authenticity.contexts).toEqual([
        { authservId: 'mx.propio.example', fromAddress: 'security@facebook.com' },
      ]);
      expect(recorder.accepted).toHaveLength(1);
    });
  });

  describe('a message that is quarantined', () => {
    it('quarantines a failed gate with its reason and does not count it as a source failure', async () => {
      authenticity.assessment = {
        ok: true,
        validatedSignatures: [],
        verdicts: { spf: 'pass', dkim: 'fail', dmarc: 'fail' },
      };
      session.messages = [buildMailboxMessage(3)];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toMatchObject({
        status: 'completed',
        summary: { accepted: 0, quarantinedByReason: { NO_VALID_SIGNATURE: 1 } },
      });
      expect(recorder.quarantined).toEqual([
        {
          fingerprint: 'raw:00aa:msg-3',
          receivedAt: new Date(FIXTURE_NOW.getTime() - 30 * 1000),
          reason: 'NO_VALID_SIGNATURE',
        },
      ]);
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 3 }]);
      expect(state.failureReleases).toEqual([]);
    });

    it('quarantines ambiguous Authentication-Results and DKIM signatures', async () => {
      for (const reason of ['AUTH_RESULTS_AMBIGUOUS', 'DKIM_SIGNATURE_AMBIGUOUS'] as const) {
        recorder = new FakeRecorder();
        authenticity.assessment = { ok: false, reason };
        session.messages = [buildMailboxMessage(4)];

        await buildUseCase().execute(POLL_SOURCE);

        expect(recorder.quarantined.map((entry) => entry.reason)).toEqual([reason]);
      }
    });

    it('quarantines an unparseable message and keeps going with the rest', async () => {
      mime.perMessage.set('msg-2', new MimeParseError());
      session.messages = [buildMailboxMessage(2), buildMailboxMessage(1)];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(recorder.quarantined.map((entry) => entry.reason)).toEqual(['PARSE_ERROR']);
      expect(recorder.accepted).toHaveLength(1);
      expect(result.status).toBe('completed');
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 2 }]);
    });

    it('quarantines a message whose download fails, using its mailbox position as fingerprint', async () => {
      session.fetchFailures.set(6, new MessageFetchError());
      session.messages = [buildMailboxMessage(6)];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(recorder.quarantined).toEqual([
        {
          fingerprint: `pos:00aa:${String(POLL_UID_VALIDITY)}:6`,
          receivedAt: new Date(FIXTURE_NOW.getTime() - 30 * 1000),
          reason: 'FETCH_FAILED',
        },
      ]);
      expect(result.status).toBe('completed');
      expect(state.failureReleases).toEqual([]);
    });

    it('quarantines an oversized announced message without downloading it', async () => {
      session.messages = [buildMailboxMessage(8, { sizeBytes: 10 * 1024 * 1024 })];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([]);
      expect(recorder.quarantined.map((entry) => entry.reason)).toEqual(['MESSAGE_TOO_LARGE']);
    });

    it('treats a non-numeric announced size as oversized (fails closed)', async () => {
      session.messages = [buildMailboxMessage(8, { sizeBytes: Number.NaN })];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([]);
      expect(recorder.quarantined.map((entry) => entry.reason)).toEqual(['MESSAGE_TOO_LARGE']);
    });

    it('quarantines a download cut at the limit and never parses a truncated message', async () => {
      session.truncatedUids.add(8);
      session.messages = [buildMailboxMessage(8)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(mime.parsedCalls).toBe(0);
      expect(recorder.quarantined.map((entry) => entry.reason)).toEqual(['MESSAGE_TOO_LARGE']);
    });
  });

  describe('deduplication', () => {
    it('skips a message whose receipt already exists before parsing it', async () => {
      recorder.receipts.add('raw:00aa:msg-5');
      session.messages = [buildMailboxMessage(5)];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(mime.parsedCalls).toBe(0);
      expect(result).toMatchObject({
        status: 'completed',
        summary: { duplicates: 1, accepted: 0 },
      });
      expect(observer.records.map((entry) => entry.outcome)).toEqual(['duplicate']);
    });

    it('counts a race lost at insert time as a duplicate, not as an accepted message', async () => {
      session.messages = [buildMailboxMessage(5)];
      const racing = new FakeRecorder();
      racing.recordAccepted = () => Promise.resolve('duplicate');
      recorder = racing;

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toMatchObject({
        status: 'completed',
        summary: { duplicates: 1, accepted: 0 },
      });
    });

    it('polling the same mailbox twice records each message once', async () => {
      session.messages = [buildMailboxMessage(2), buildMailboxMessage(1)];

      await buildUseCase().execute(POLL_SOURCE);
      const second = await buildUseCase().execute(POLL_SOURCE);

      expect(recorder.accepted).toHaveLength(2);
      expect(second).toMatchObject({ summary: { duplicates: 2, accepted: 0 } });
    });
  });

  describe('selection', () => {
    it('processes the newest messages first and stops at the per-pass cap', async () => {
      const total = POLL_MAX_MESSAGES_PER_PASS + 10;
      session.messages = Array.from({ length: total }, (_, index) =>
        buildMailboxMessage(index + 1),
      );

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toHaveLength(POLL_MAX_MESSAGES_PER_PASS);
      expect(session.fetchedUids[0]).toBe(total);
      expect(session.fetchedUids.at(-1)).toBe(total - POLL_MAX_MESSAGES_PER_PASS + 1);
      expect(result).toMatchObject({ summary: { droppedByCap: 10 } });
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: total }]);
    });

    it('ignores messages older than the window before applying the cap, but still advances the cursor', async () => {
      const tooOld = new Date(FIXTURE_NOW.getTime() - POLL_MESSAGE_WINDOW_MS - 1000);
      session.messages = [
        buildMailboxMessage(10, { internalDate: tooOld }),
        buildMailboxMessage(9),
      ];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([9]);
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 10 }]);
    });

    it('ignores messages with an invalid internal date', async () => {
      session.messages = [buildMailboxMessage(4, { internalDate: new Date(Number.NaN) })];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([]);
    });

    it('filters out UIDs at or below the cursor even if the server returns them', async () => {
      state.cursor = { uidValidity: POLL_UID_VALIDITY, lastUid: 5, consecutiveFailures: 0 };
      session.messages = [buildMailboxMessage(5), buildMailboxMessage(4), buildMailboxMessage(6)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.listCalls[0]?.afterUid).toBe(5);
      expect(session.fetchedUids).toEqual([6]);
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 6 }]);
    });

    it('restarts from zero when UIDVALIDITY changed', async () => {
      state.cursor = { uidValidity: POLL_UID_VALIDITY - 1, lastUid: 500, consecutiveFailures: 0 };
      session.messages = [buildMailboxMessage(3)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.listCalls[0]?.afterUid).toBe(0);
      expect(session.fetchedUids).toEqual([3]);
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 3 }]);
    });

    it('stores the new UIDVALIDITY even when the mailbox has nothing new', async () => {
      state.cursor = { uidValidity: POLL_UID_VALIDITY - 1, lastUid: 500, consecutiveFailures: 0 };

      await buildUseCase().execute(POLL_SOURCE);

      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 0 }]);
    });

    it('asks for messages since the start of the window', async () => {
      await buildUseCase().execute(POLL_SOURCE);

      expect(session.listCalls[0]?.since).toEqual(
        new Date(FIXTURE_NOW.getTime() - POLL_MESSAGE_WINDOW_MS),
      );
    });
  });

  describe('prefilter by envelope sender', () => {
    it('skips messages from senders no template could match, without downloading or a receipt', async () => {
      session.messages = [
        buildMailboxMessage(2, { envelopeFromAddress: 'spam@otro.example' }),
        buildMailboxMessage(1, { envelopeFromAddress: null }),
      ];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([]);
      expect(recorder.receipts.size).toBe(0);
      expect(result).toMatchObject({ summary: { skippedByPrefilter: 2 } });
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 2 }]);
    });

    it('keeps messages whose sender domain matches any template', async () => {
      templates.templates = [
        buildLoginCodeTemplate({ id: 'otro', senderAddress: 'no-reply@otraplataforma.example' }),
      ];
      session.messages = [
        buildMailboxMessage(1, { envelopeFromAddress: 'Alertas@OtraPlataforma.example' }),
      ];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([1]);
    });
  });

  describe('sources without templates', () => {
    it('completes without opening the mailbox or moving the cursor', async () => {
      templates.templates = [];

      const result = await buildUseCase().execute(POLL_SOURCE);

      expect(result).toMatchObject({ status: 'completed', summary: { templatesFound: 0 } });
      expect(connector.openCalls).toBe(0);
      expect(state.savedCursors).toEqual([]);
      expect(state.successReleases).toBe(1);
    });
  });

  describe('arguments handed to the ports', () => {
    it('claims the source with the lease and bounds every fetch by the size limit', async () => {
      session.messages = [buildMailboxMessage(1), buildMailboxMessage(2)];

      await buildUseCase().execute(POLL_SOURCE);

      expect(state.claimArgs).toEqual([
        { source: POLL_SOURCE, now: FIXTURE_NOW, leaseMs: POLL_LEASE_MS },
      ]);
      expect(session.fetchMaxBytes).toEqual([POLL_MAX_MESSAGE_BYTES, POLL_MAX_MESSAGE_BYTES]);
    });

    it('accepts a message of exactly the size limit and quarantines one byte over', async () => {
      session.messages = [
        buildMailboxMessage(1, { sizeBytes: POLL_MAX_MESSAGE_BYTES }),
        buildMailboxMessage(2, { sizeBytes: POLL_MAX_MESSAGE_BYTES + 1 }),
      ];

      const result = await buildUseCase().execute(POLL_SOURCE);

      if (result.status !== 'completed') throw new Error('expected a completed pass');
      expect(session.fetchedUids).toEqual([1]);
      expect(result.summary.quarantinedByReason).toEqual({ MESSAGE_TOO_LARGE: 1 });
    });

    it('keeps a message received exactly at the window start and drops one second older', async () => {
      const windowStart = computeWindowStart(FIXTURE_NOW);
      session.messages = [
        buildMailboxMessage(1, { internalDate: new Date(windowStart.getTime() - 1000) }),
        buildMailboxMessage(2, { internalDate: windowStart }),
      ];

      await buildUseCase().execute(POLL_SOURCE);

      expect(session.fetchedUids).toEqual([2]);
    });
  });

  describe('time budget', () => {
    it('stops handling messages once the source budget is spent and reports the rest', async () => {
      // Cada lectura del reloj avanza 20 s: la pasada agota el presupuesto tras unos pocos mensajes.
      clock = new FakeClock(FIXTURE_NOW, 20 * 1000);
      session.messages = Array.from({ length: 10 }, (_, index) => buildMailboxMessage(index + 1));

      const result = await buildUseCase().execute(POLL_SOURCE);

      if (result.status !== 'completed') throw new Error('expected a completed pass');
      expect(result.summary.abandonedByBudget).toBeGreaterThan(0);
      expect(session.fetchedUids.length + result.summary.abandonedByBudget).toBe(10);
      expect(POLL_SOURCE_BUDGET_MS).toBe(60 * 1000);
      // Los abandonados siguen dentro de la ventana: el cursor queda bajo el UID más bajo para reintentarlos.
      expect(state.savedCursors).toEqual([{ uidValidity: POLL_UID_VALIDITY, lastUid: 0 }]);
    });
  });
});
