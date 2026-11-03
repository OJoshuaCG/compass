import type { Clock } from '../../../shared/kernel/index.js';
import { evaluateInboundMail } from '../domain/inbound-evaluation.js';
import type { InboundMailMessage, QuarantineReason } from '../domain/inbound-evaluation.js';
import { normalizeEmailAddress } from '../domain/mail-address.js';
import {
  POLL_LEASE_MS,
  POLL_MAX_MESSAGES_PER_PASS,
  POLL_MAX_MESSAGE_BYTES,
  POLL_SOURCE_BUDGET_MS,
  computeBackoffMs,
  computeWindowStart,
} from '../domain/poll-policy.js';
import type { InboundTemplate } from '../domain/inbound-template.js';
import type {
  InboundRecorder,
  MessageFingerprinter,
  SourceTemplateStore,
} from './ports/inbound-recorder.js';
import type { MailConnectionLoader } from './ports/mail-connection-loader.js';
import { MailboxConnectionError, MessageFetchError } from './ports/mailbox.js';
import type { MailboxConnector, MailboxMessageSummary, MailboxSession } from './ports/mailbox.js';
import { MimeParseError } from './ports/mime-and-authenticity.js';
import type {
  AuthenticityVerdicts,
  AuthenticityVerifier,
  MimeParser,
} from './ports/mime-and-authenticity.js';
import type { PollCursor, PollStateStore, SourceRef } from './ports/poll-state-store.js';

/** Código de la pasada cuando una excepción no es de las tipadas (un defecto, no un fallo del buzón). */
const UNEXPECTED_FAILURE_CODE = 'UNEXPECTED';

/** Fallo de conexión con código acotado detectado por el propio caso de uso. */
class PollFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PollFailure';
  }
}

/**
 * Línea del registro por mensaje (ADR 0045, "Registro para validar DKIM en la fase 2"). NUNCA lleva asunto,
 * cuerpo, direcciones, código ni enlace.
 */
export interface PollMessageRecord {
  readonly sourceId: string;
  readonly fingerprint: string | null;
  readonly outcome: 'accepted' | 'quarantined' | 'duplicate' | 'skipped_by_prefilter';
  readonly reason: QuarantineReason | null;
  readonly verdicts: AuthenticityVerdicts | null;
}

export interface PollObserver {
  messageHandled(record: PollMessageRecord): void;
}

export interface PollSummary {
  readonly templatesFound: number;
  readonly listed: number;
  readonly accepted: number;
  readonly quarantinedByReason: Readonly<Partial<Record<QuarantineReason, number>>>;
  readonly duplicates: number;
  readonly skippedByPrefilter: number;
  /** Más nuevos que el tope por pasada: los más viejos se descartan (envejecen fuera de la ventana). */
  readonly droppedByCap: number;
  readonly abandonedByBudget: number;
}

export type PollSourceResult =
  | { readonly status: 'skipped_leased' }
  | { readonly status: 'failed'; readonly errorCode: string }
  | { readonly status: 'completed'; readonly summary: PollSummary };

interface Dependencies {
  readonly state: PollStateStore;
  readonly connections: MailConnectionLoader;
  readonly templates: SourceTemplateStore;
  readonly mailbox: MailboxConnector;
  readonly mime: MimeParser;
  readonly authenticity: AuthenticityVerifier;
  readonly fingerprints: MessageFingerprinter;
  readonly recorder: InboundRecorder;
  readonly clock: Clock;
  readonly observer: PollObserver;
}

/** Contadores mutables de una pasada; se congelan en `PollSummary` al terminar. */
interface Tally {
  templatesFound: number;
  listed: number;
  accepted: number;
  quarantinedByReason: Partial<Record<QuarantineReason, number>>;
  duplicates: number;
  skippedByPrefilter: number;
  droppedByCap: number;
  abandonedByBudget: number;
}

interface PassContext {
  readonly source: SourceRef;
  readonly session: MailboxSession;
  readonly connection: {
    readonly sourceAddress: string;
    readonly authservId: string;
    readonly acceptedRecipients: readonly string[];
  };
  readonly templates: readonly InboundTemplate[];
  readonly senderDomains: ReadonlySet<string>;
  readonly tally: Tally;
}

/**
 * Una pasada de sondeo sobre una fuente de correo (ADR 0045, "Diseño de IC-3 por IMAP", pasos 2 a 14).
 *
 * Reglas que este caso de uso hace cumplir:
 * - La fuente se reclama con arrendamiento antes de tocar la red y se libera siempre al terminar.
 * - Fallo de conexión (red, TLS, autenticación, buzón): el cursor NO avanza y la fuente entra en retroceso.
 * - Fallo de mensaje (descarga, análisis, tamaño, autenticidad): cuarentena con motivo acotado, el cursor
 *   avanza y no cuenta como fallo de la fuente; un mensaje venenoso no bloquea la cola.
 * - Un mensaje, una transacción corta (la lleva el `InboundRecorder`); idempotente por huella.
 * - Los más nuevos primero, solo dentro de la ventana de antigüedad y con tope por pasada.
 */
export class PollMailSource {
  constructor(private readonly deps: Dependencies) {}

  async execute(source: SourceRef): Promise<PollSourceResult> {
    const { state, clock } = this.deps;
    const startedAt = clock.now();
    const cursor = await state.claim(source, startedAt, POLL_LEASE_MS);
    if (cursor === null) return { status: 'skipped_leased' };

    let summary: PollSummary;
    try {
      summary = await this.pollClaimedSource(source, cursor, startedAt);
    } catch (error) {
      const errorCode = toErrorCode(error);
      const failedAt = clock.now();
      const backoffMs = computeBackoffMs(cursor.consecutiveFailures + 1);
      await state.releaseAfterFailure(
        source,
        { errorCode, nextAttemptAt: new Date(failedAt.getTime() + backoffMs) },
        failedAt,
      );
      return { status: 'failed', errorCode };
    }
    await state.releaseAfterSuccess(source, clock.now());
    return { status: 'completed', summary };
  }

  private async pollClaimedSource(
    source: SourceRef,
    cursor: PollCursor,
    startedAt: Date,
  ): Promise<PollSummary> {
    const { connections, templates: templateStore, mailbox, state, clock } = this.deps;
    const tally = createTally();

    const loaded = await connections.load(source);
    if (!loaded.ok) throw new PollFailure(loaded.code);
    const { connection } = loaded;

    const templates = await templateStore.listForSource(source);
    tally.templatesFound = templates.length;
    // Sin plantillas ningún mensaje podría aceptarse: no se abre el buzón ni se mueve el cursor.
    if (templates.length === 0) return freezeTally(tally);

    const session = await mailbox.open(connection);
    try {
      // Si UIDVALIDITY cambió los UID guardados no significan nada: se parte de cero y mandan la ventana
      // de antigüedad y la deduplicación por huella.
      const baselineUid = cursor.uidValidity === session.uidValidity ? cursor.lastUid : 0;
      const windowStart = computeWindowStart(startedAt);

      const listed = await session.list(baselineUid, windowStart);
      tally.listed = listed.length;
      const newerThanCursor = listed
        .filter((message) => Number.isSafeInteger(message.uid) && message.uid > baselineUid)
        .sort((first, second) => second.uid - first.uid);
      const withinWindow = newerThanCursor.filter((message) =>
        isWithinWindow(message, windowStart),
      );
      const candidates = withinWindow.slice(0, POLL_MAX_MESSAGES_PER_PASS);
      tally.droppedByCap = withinWindow.length - candidates.length;

      const context: PassContext = {
        source,
        session,
        connection,
        templates,
        senderDomains: collectSenderDomains(templates),
        tally,
      };
      let lowestAbandonedUid: number | null = null;
      for (const [index, message] of candidates.entries()) {
        const elapsedMs = clock.now().getTime() - startedAt.getTime();
        if (elapsedMs >= POLL_SOURCE_BUDGET_MS) {
          tally.abandonedByBudget = candidates.length - index;
          // Los candidatos van de más nuevo a más viejo: el último es el UID abandonado más bajo.
          lowestAbandonedUid = candidates[candidates.length - 1]?.uid ?? null;
          break;
        }
        await this.handleMessage(context, message);
      }

      // Por defecto el cursor llega al UID más alto visto: lo que quedó fuera por el tope ya sale de la
      // ventana antes de que valga la pena reintentarlo. Distinto es el presupuesto agotado: esos mensajes
      // siguen dentro de la ventana y el código vive 10 minutos, así que el cursor se queda justo debajo
      // del más bajo abandonado. Los ya procesados se reexaminan en la siguiente pasada y los descarta el
      // recibo (deduplicación).
      const highestUid = newerThanCursor[0]?.uid ?? baselineUid;
      const cursorUid =
        lowestAbandonedUid === null ? highestUid : Math.max(baselineUid, lowestAbandonedUid - 1);
      await state.saveCursor(
        source,
        { uidValidity: session.uidValidity, lastUid: cursorUid },
        clock.now(),
      );
    } finally {
      await session.close().catch(() => undefined);
    }
    return freezeTally(tally);
  }

  private async handleMessage(context: PassContext, message: MailboxMessageSummary): Promise<void> {
    const { source, session, tally } = context;
    const { fingerprints, recorder, mime, authenticity } = this.deps;

    if (!isRelevantSender(message.envelopeFromAddress, context.senderDomains)) {
      tally.skippedByPrefilter += 1;
      this.observe(source, null, 'skipped_by_prefilter', null, null);
      return;
    }

    const positionFingerprint = fingerprints.forMailboxPosition(
      source.sourceId,
      session.uidValidity,
      message.uid,
    );
    const receivedAt = message.internalDate;

    // `!(x <= tope)` también rechaza un tamaño anunciado no numérico.
    if (!(message.sizeBytes <= POLL_MAX_MESSAGE_BYTES)) {
      await this.quarantine(
        source,
        tally,
        positionFingerprint,
        receivedAt,
        'MESSAGE_TOO_LARGE',
        null,
      );
      return;
    }

    let raw;
    try {
      raw = await session.fetchRaw(message.uid, POLL_MAX_MESSAGE_BYTES);
    } catch (error) {
      if (error instanceof MessageFetchError) {
        await this.quarantine(source, tally, positionFingerprint, receivedAt, 'FETCH_FAILED', null);
        return;
      }
      throw error;
    }
    if (raw.truncated) {
      await this.quarantine(
        source,
        tally,
        positionFingerprint,
        receivedAt,
        'MESSAGE_TOO_LARGE',
        null,
      );
      return;
    }

    const fingerprint = fingerprints.forRawMessage(source.sourceId, raw.bytes);
    if (await recorder.hasReceipt(source, fingerprint)) {
      tally.duplicates += 1;
      this.observe(source, fingerprint, 'duplicate', null, null);
      return;
    }

    let parsed;
    try {
      parsed = await mime.parse(raw.bytes);
    } catch (error) {
      if (error instanceof MimeParseError) {
        await this.quarantine(source, tally, fingerprint, receivedAt, 'PARSE_ERROR', null);
        return;
      }
      throw error;
    }

    const assessment = authenticity.assess(parsed, {
      authservId: context.connection.authservId,
      fromAddress: parsed.fromAddress,
    });
    if (!assessment.ok) {
      await this.quarantine(source, tally, fingerprint, receivedAt, assessment.reason, null);
      return;
    }

    const inboundMessage: InboundMailMessage = {
      sourceAlias: context.connection.sourceAddress,
      acceptedRecipients: context.connection.acceptedRecipients,
      receivedAt,
      fingerprint,
      fromAddress: parsed.fromAddress,
      toAddresses: parsed.toAddresses,
      headerInstanceCounts: parsed.headerInstanceCounts,
      subject: parsed.subject,
      dateHeader: parsed.dateHeader,
      validatedSignatures: assessment.validatedSignatures,
      body: parsed.bodyText,
    };
    // Las huellas conocidas ya se consultaron arriba; la restricción única de la base cubre la carrera.
    const evaluation = evaluateInboundMail(inboundMessage, context.templates, new Set());

    if (evaluation.outcome === 'quarantined') {
      await this.quarantine(
        source,
        tally,
        fingerprint,
        receivedAt,
        evaluation.reason,
        assessment.verdicts,
      );
      return;
    }

    const outcome = await recorder.recordAccepted(source, {
      fingerprint,
      receivedAt,
      templateId: evaluation.templateId,
      kind: evaluation.kind,
      visibility: evaluation.visibility,
      valueType: evaluation.value.type,
      value: evaluation.value.type === 'code' ? evaluation.value.code : evaluation.value.url,
      expiresAt: evaluation.expiresAt,
      signingDomain: evaluation.signingDomain,
    });
    if (outcome === 'duplicate') {
      tally.duplicates += 1;
      this.observe(source, fingerprint, 'duplicate', null, assessment.verdicts);
      return;
    }
    tally.accepted += 1;
    this.observe(source, fingerprint, 'accepted', null, assessment.verdicts);
  }

  private async quarantine(
    source: SourceRef,
    tally: Tally,
    fingerprint: string,
    receivedAt: Date,
    reason: QuarantineReason,
    verdicts: AuthenticityVerdicts | null,
  ): Promise<void> {
    const outcome = await this.deps.recorder.recordQuarantine(source, {
      fingerprint,
      receivedAt,
      reason,
    });
    if (outcome === 'duplicate') {
      tally.duplicates += 1;
      this.observe(source, fingerprint, 'duplicate', null, verdicts);
      return;
    }
    tally.quarantinedByReason[reason] = (tally.quarantinedByReason[reason] ?? 0) + 1;
    this.observe(source, fingerprint, 'quarantined', reason, verdicts);
  }

  private observe(
    source: SourceRef,
    fingerprint: string | null,
    outcome: PollMessageRecord['outcome'],
    reason: QuarantineReason | null,
    verdicts: AuthenticityVerdicts | null,
  ): void {
    this.deps.observer.messageHandled({
      sourceId: source.sourceId,
      fingerprint,
      outcome,
      reason,
      verdicts,
    });
  }
}

function createTally(): Tally {
  return {
    templatesFound: 0,
    listed: 0,
    accepted: 0,
    quarantinedByReason: {},
    duplicates: 0,
    skippedByPrefilter: 0,
    droppedByCap: 0,
    abandonedByBudget: 0,
  };
}

function freezeTally(tally: Tally): PollSummary {
  return { ...tally, quarantinedByReason: { ...tally.quarantinedByReason } };
}

function toErrorCode(error: unknown): string {
  if (error instanceof MailboxConnectionError) return error.code;
  if (error instanceof PollFailure) return error.code;
  return UNEXPECTED_FAILURE_CODE;
}

/** Una fecha inválida nunca queda dentro de la ventana (falla cerrado). */
function isWithinWindow(message: MailboxMessageSummary, windowStart: Date): boolean {
  const receivedMs = message.internalDate.getTime();
  return !Number.isNaN(receivedMs) && receivedMs >= windowStart.getTime();
}

function collectSenderDomains(templates: readonly InboundTemplate[]): ReadonlySet<string> {
  const domains = new Set<string>();
  for (const template of templates) {
    const sender = normalizeEmailAddress(template.senderAddress);
    if (sender !== null) domains.add(sender.domain);
  }
  return domains;
}

/**
 * Prefiltro con el `ENVELOPE`: solo ahorra descargas. La decisión real de remitente la toma la compuerta
 * DKIM con el `From` autenticado; un `ENVELOPE` falso solo puede hacer que se descargue de más o de menos.
 */
function isRelevantSender(
  envelopeFrom: string | null,
  senderDomains: ReadonlySet<string>,
): boolean {
  if (envelopeFrom === null) return false;
  const sender = normalizeEmailAddress(envelopeFrom);
  return sender !== null && senderDomains.has(sender.domain);
}
