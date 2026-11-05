/** Dobles en memoria de los puertos del sondeo IMAP (IC-3b). No tocan red, base de datos ni criptografía. */
import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { Clock } from '../../../shared/kernel/index.js';
import type { PollMessageRecord, PollObserver } from '../application/poll-mail-source.js';
import type {
  AcceptedRecord,
  InboundRecorder,
  MessageFingerprinter,
  QuarantineRecord,
  RecordOutcome,
  SourceTemplateStore,
} from '../application/ports/inbound-recorder.js';
import type {
  MailConnection,
  MailConnectionLoader,
  MailConnectionLoadResult,
} from '../application/ports/mail-connection-loader.js';
import type {
  MailboxConnector,
  MailboxMessageSummary,
  MailboxSession,
  RawMessage,
} from '../application/ports/mailbox.js';
import type {
  AuthenticityAssessment,
  AuthenticityVerifier,
  MimeParser,
  ParsedMail,
} from '../application/ports/mime-and-authenticity.js';
import type {
  PollCursor,
  PollStateStore,
  SourceRef,
} from '../application/ports/poll-state-store.js';
import type { InboundTemplate } from '../domain/inbound-template.js';
import {
  FIXTURE_ALIAS,
  FIXTURE_CODE,
  FIXTURE_NOW,
  FIXTURE_SENDER,
  FIXTURE_SUBJECT,
  buildLoginCodeTemplate,
  buildSignature,
} from './mail-fixtures.js';

export const POLL_SOURCE: SourceRef = {
  organizationId: asOrganizationId('0194f0a0-0000-7000-8000-000000000001'),
  sourceId: '0194f0a0-0000-7000-8000-0000000000aa',
};

export const POLL_UID_VALIDITY = 7001;

export function buildConnection(overrides: Partial<MailConnection> = {}): MailConnection {
  return {
    host: 'imap.example.test',
    port: 993,
    username: 'buzon@example.test',
    password: 'contrasena-de-prueba',
    tlsMode: 'tls',
    authservId: 'mx.example.test',
    sourceAddress: FIXTURE_ALIAS,
    acceptedRecipients: [FIXTURE_ALIAS],
    ...overrides,
  };
}

/** Reloj que avanza `stepMs` en cada lectura; con 0 queda fijo. */
export class FakeClock implements Clock {
  private currentMs: number;

  constructor(
    start: Date = FIXTURE_NOW,
    private readonly stepMs = 0,
  ) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    const value = new Date(this.currentMs);
    this.currentMs += this.stepMs;
    return value;
  }
}

export class FakePollStateStore implements PollStateStore {
  readonly calls: string[] = [];
  cursor: PollCursor | null = { uidValidity: null, lastUid: 0, consecutiveFailures: 0 };
  savedCursors: { uidValidity: number; lastUid: number }[] = [];
  successReleases = 0;
  failureReleases: { errorCode: string; nextAttemptAt: Date; now: Date }[] = [];

  claimArgs: { source: SourceRef; now: Date; leaseMs: number }[] = [];

  claim(source: SourceRef, now: Date, leaseMs: number): Promise<PollCursor | null> {
    this.calls.push('claim');
    this.claimArgs.push({ source, now, leaseMs });
    return Promise.resolve(this.cursor);
  }

  saveCursor(_source: SourceRef, cursor: { uidValidity: number; lastUid: number }): Promise<void> {
    this.calls.push('saveCursor');
    this.savedCursors.push(cursor);
    return Promise.resolve();
  }

  releaseAfterSuccess(): Promise<void> {
    this.calls.push('releaseAfterSuccess');
    this.successReleases += 1;
    return Promise.resolve();
  }

  releaseAfterFailure(
    _source: SourceRef,
    failure: { errorCode: string; nextAttemptAt: Date },
    now: Date,
  ): Promise<void> {
    this.calls.push('releaseAfterFailure');
    this.failureReleases.push({ ...failure, now });
    return Promise.resolve();
  }
}

export class FakeConnectionLoader implements MailConnectionLoader {
  loadCalls = 0;
  result: MailConnectionLoadResult = { ok: true, connection: buildConnection() };

  load(): Promise<MailConnectionLoadResult> {
    this.loadCalls += 1;
    return Promise.resolve(this.result);
  }
}

export class FakeTemplateStore implements SourceTemplateStore {
  templates: readonly InboundTemplate[] = [buildLoginCodeTemplate()];

  listForSource(): Promise<readonly InboundTemplate[]> {
    return Promise.resolve(this.templates);
  }
}

/** Mensaje de buzón de prueba: sus bytes crudos son `msg-<uid>`, que el parser falso reconoce. */
export function buildMailboxMessage(
  uid: number,
  overrides: Partial<MailboxMessageSummary> = {},
): MailboxMessageSummary {
  return {
    uid,
    internalDate: new Date(FIXTURE_NOW.getTime() - 30 * 1000),
    sizeBytes: 2048,
    envelopeFromAddress: FIXTURE_SENDER,
    ...overrides,
  };
}

export class FakeMailboxSession implements MailboxSession {
  listCalls: { afterUid: number; since: Date }[] = [];
  fetchedUids: number[] = [];
  fetchMaxBytes: number[] = [];
  closeCalls = 0;
  /** Se devuelve TODO lo configurado, sin filtrar: el caso de uso debe filtrar por su cuenta. */
  messages: readonly MailboxMessageSummary[] = [];
  fetchFailures = new Map<number, Error>();
  truncatedUids = new Set<number>();
  closeError: Error | null = null;

  constructor(readonly uidValidity: number = POLL_UID_VALIDITY) {}

  list(afterUid: number, since: Date): Promise<readonly MailboxMessageSummary[]> {
    this.listCalls.push({ afterUid, since });
    return Promise.resolve(this.messages);
  }

  fetchRaw(uid: number, maxBytes: number): Promise<RawMessage> {
    this.fetchedUids.push(uid);
    this.fetchMaxBytes.push(maxBytes);
    const failure = this.fetchFailures.get(uid);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve({
      bytes: new TextEncoder().encode(`msg-${String(uid)}`),
      truncated: this.truncatedUids.has(uid),
    });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    if (this.closeError !== null) return Promise.reject(this.closeError);
    return Promise.resolve();
  }
}

export class FakeMailboxConnector implements MailboxConnector {
  openCalls = 0;
  openError: Error | null = null;

  constructor(readonly session: FakeMailboxSession = new FakeMailboxSession()) {}

  open(): Promise<MailboxSession> {
    this.openCalls += 1;
    if (this.openError !== null) return Promise.reject(this.openError);
    return Promise.resolve(this.session);
  }
}

export function buildParsedMail(overrides: Partial<ParsedMail> = {}): ParsedMail {
  return {
    fromAddress: FIXTURE_SENDER,
    toAddresses: [FIXTURE_ALIAS],
    subject: FIXTURE_SUBJECT,
    dateHeader: new Date(FIXTURE_NOW.getTime() - 20 * 1000),
    headerInstanceCounts: { from: 1, to: 1, subject: 1, date: 1 },
    relevantHeaders: [],
    bodyText: `Hola.\nTu código es: ${FIXTURE_CODE}\nNo lo compartas.`,
    ...overrides,
  };
}

export class FakeMimeParser implements MimeParser {
  parsedCalls = 0;
  /** Por texto crudo (`msg-<uid>`); si no hay entrada se devuelve el correo válido por defecto. */
  readonly perMessage = new Map<string, ParsedMail | Error>();

  parse(rawMessage: Uint8Array): Promise<ParsedMail> {
    this.parsedCalls += 1;
    const text = new TextDecoder().decode(rawMessage);
    const configured = this.perMessage.get(text);
    if (configured instanceof Error) return Promise.reject(configured);
    return Promise.resolve(configured ?? buildParsedMail());
  }
}

export class FakeAuthenticityVerifier implements AuthenticityVerifier {
  assessment: AuthenticityAssessment = {
    ok: true,
    validatedSignatures: [buildSignature()],
    verdicts: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
  };
  contexts: { authservId: string; fromAddress: string | null }[] = [];

  assess(
    _mail: ParsedMail,
    context: { authservId: string; fromAddress: string | null },
  ): AuthenticityAssessment {
    this.contexts.push(context);
    return this.assessment;
  }
}

export class FakeFingerprinter implements MessageFingerprinter {
  forRawMessage(sourceId: string, rawMessage: Uint8Array): string {
    return `raw:${sourceId.slice(-4)}:${new TextDecoder().decode(rawMessage)}`;
  }

  forMailboxPosition(sourceId: string, uidValidity: number, uid: number): string {
    return `pos:${sourceId.slice(-4)}:${String(uidValidity)}:${String(uid)}`;
  }
}

export class FakeRecorder implements InboundRecorder {
  readonly receipts = new Set<string>();
  readonly accepted: AcceptedRecord[] = [];
  readonly quarantined: QuarantineRecord[] = [];
  /** Si se fija, la siguiente escritura lanza este error (simula un defecto o la base caída). */
  writeError: Error | null = null;

  hasReceipt(_source: SourceRef, fingerprint: string): Promise<boolean> {
    return Promise.resolve(this.receipts.has(fingerprint));
  }

  recordAccepted(_source: SourceRef, record: AcceptedRecord): Promise<RecordOutcome> {
    if (this.writeError !== null) return Promise.reject(this.writeError);
    if (this.receipts.has(record.fingerprint)) return Promise.resolve('duplicate');
    this.receipts.add(record.fingerprint);
    this.accepted.push(record);
    return Promise.resolve('recorded');
  }

  recordQuarantine(_source: SourceRef, record: QuarantineRecord): Promise<RecordOutcome> {
    if (this.writeError !== null) return Promise.reject(this.writeError);
    if (this.receipts.has(record.fingerprint)) return Promise.resolve('duplicate');
    this.receipts.add(record.fingerprint);
    this.quarantined.push(record);
    return Promise.resolve('recorded');
  }
}

export class FakeObserver implements PollObserver {
  readonly records: PollMessageRecord[] = [];

  messageHandled(record: PollMessageRecord): void {
    this.records.push(record);
  }
}
