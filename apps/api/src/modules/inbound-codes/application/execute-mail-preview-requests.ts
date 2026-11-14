/**
 * Trae, para UNA fuente, el asunto o el cuerpo de los correos que una persona pidió ver (ADR 0045, enmienda
 * «borrado de correo a petición»; odd/tasks/inbound-mail-delete.md, S6). Corre en el worker de sondeo, el único
 * que descifra la contraseña del buzón; la API solo registra la petición y luego entrega el resultado.
 *
 * Invariantes de seguridad
 * - Solo trae lo que una persona ya autorizó y auditó al pedirlo: nunca decide por su cuenta.
 * - Abre el buzón de SOLO LECTURA (`EXAMINE`): ver un correo nunca lo marca ni lo cambia.
 * - Antes de descargar compara el `UIDVALIDITY` guardado con el del buzón. Si difiere, los UID ya no apuntan a
 *   los mismos mensajes: se cierra con `POSITION_CHANGED` y NO se descarga nada.
 * - El mensaje se analiza en el proceso hijo sin acceso a la base, al KMS ni a la contraseña. Un mensaje truncado
 *   no se analiza. Solo sale texto plano: el HTML nunca llega aquí.
 * - El contenido se limpia (controles y marcas de dirección fuera) y se cifra DENTRO del adaptador de la base; este
 *   caso de uso nunca lo registra ni lo guarda en claro. Un contenido demasiado grande se rechaza, no se trunca.
 * - Una petición ya vencida no se toma; el resto de filas vencidas las purga `RunMailPreviewRequests`.
 */
import type { Clock } from '../../../shared/kernel/index.js';
import {
  MAIL_PREVIEW_TTL_MS,
  MAX_PREVIEW_CONTENT_BYTES,
  MAX_PREVIEW_LENGTH,
  sanitizePreviewText,
} from '../domain/mail-preview.js';
import type { MailPreviewKind } from '../domain/mail-preview.js';
import { POLL_MAX_MESSAGE_BYTES } from '../domain/poll-policy.js';
import type { MailConnectionLoader } from './ports/mail-connection-loader.js';
import type {
  MailPreviewFailureCode,
  MailPreviewWorkStore,
  PendingMailPreview,
} from './ports/mail-preview-work-store.js';
import { MailboxConnectionError, MessageFetchError } from './ports/mailbox.js';
import type { MailboxConnector, MailboxSession } from './ports/mailbox.js';
import { MimeParseError } from './ports/mime-and-authenticity.js';
import type { MimeParser, ParsedMail } from './ports/mime-and-authenticity.js';
import type { SourceRef } from './ports/poll-state-store.js';

/** Tope por fuente y pasada: cada vista previa descarga un mensaje del buzón real. */
export const MAX_MAIL_PREVIEWS_PER_SOURCE = 20;

export interface ExecuteMailPreviewRequestsDeps {
  readonly work: MailPreviewWorkStore;
  readonly connections: MailConnectionLoader;
  readonly mailbox: MailboxConnector;
  readonly mime: MimeParser;
  readonly clock: Clock;
}

export interface MailPreviewSummary {
  readonly ready: number;
  readonly failed: number;
  /** Cierres por un defecto (`UNEXPECTED`): el proceso debe salir con código distinto de cero. */
  readonly unexpected: number;
}

const EMPTY_SUMMARY: MailPreviewSummary = { ready: 0, failed: 0, unexpected: 0 };

type FetchOutcome =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly code: MailPreviewFailureCode };

export class ExecuteMailPreviewRequests {
  constructor(private readonly deps: ExecuteMailPreviewRequestsDeps) {}

  async execute(source: SourceRef): Promise<MailPreviewSummary> {
    const { work, connections, mailbox } = this.deps;
    const pending = await work.listPending(
      source,
      MAX_MAIL_PREVIEWS_PER_SOURCE,
      this.deps.clock.now(),
    );
    if (pending.length === 0) return EMPTY_SUMMARY;

    const loaded = await connections.load(source);
    if (!loaded.ok) {
      const code: MailPreviewFailureCode =
        loaded.code === 'CONNECTION_MISSING' || loaded.code === 'PASSWORD_MISSING'
          ? 'CONNECTION_MISSING'
          : 'CONNECTION';
      return this.failAll(source, pending, code);
    }

    let session: MailboxSession;
    try {
      session = await mailbox.open(loaded.connection);
    } catch (error) {
      return this.failAll(
        source,
        pending,
        error instanceof MailboxConnectionError ? 'CONNECTION' : 'UNEXPECTED',
      );
    }

    try {
      return await this.previewEach(source, session, pending);
    } finally {
      await closeQuietly(session);
    }
  }

  private async previewEach(
    source: SourceRef,
    session: MailboxSession,
    pending: readonly PendingMailPreview[],
  ): Promise<MailPreviewSummary> {
    let summary = EMPTY_SUMMARY;
    for (const request of pending) {
      const outcome = await this.fetchContent(session, request);
      const now = this.deps.clock.now();
      if (outcome.ok) {
        // La vida de 15 minutos cuenta desde que el contenido existe, no desde que se pidió.
        const expiresAt = new Date(now.getTime() + MAIL_PREVIEW_TTL_MS);
        const stored = await this.deps.work.complete(
          source,
          request.requestId,
          outcome.content,
          expiresAt,
          now,
        );
        // Si la fila ya se cerró o venció mientras se descargaba, no se revive ni se cuenta como lista.
        if (stored) summary = { ...summary, ready: summary.ready + 1 };
        continue;
      }
      await this.deps.work.fail(source, request.requestId, outcome.code, now);
      summary = {
        ready: summary.ready,
        failed: summary.failed + 1,
        unexpected: summary.unexpected + (outcome.code === 'UNEXPECTED' ? 1 : 0),
      };
      // Tras un defecto la sesión puede estar en mal estado: lo que falta se reintenta en la siguiente pasada.
      if (outcome.code === 'UNEXPECTED') break;
    }
    return summary;
  }

  private async fetchContent(
    session: MailboxSession,
    request: PendingMailPreview,
  ): Promise<FetchOutcome> {
    if (session.uidValidity !== request.mailboxUidValidity) {
      return { ok: false, code: 'POSITION_CHANGED' };
    }
    try {
      const raw = await session.fetchRaw(request.mailboxUid, POLL_MAX_MESSAGE_BYTES);
      if (raw.truncated) return { ok: false, code: 'TOO_LARGE' };
      const parsed = await this.deps.mime.parse(raw.bytes);
      return this.contentOf(parsed, request.kind);
    } catch (error) {
      return { ok: false, code: failureCodeOf(error) };
    }
  }

  private contentOf(parsed: ParsedMail, kind: MailPreviewKind): FetchOutcome {
    const original = kind === 'subject' ? (parsed.subject ?? '') : parsed.bodyText;
    if (original.length > MAX_PREVIEW_LENGTH[kind]) return { ok: false, code: 'TOO_LARGE' };
    const content = sanitizePreviewText(original, kind);
    if (content.trim().length === 0) return { ok: false, code: 'EMPTY' };
    if (Buffer.byteLength(content, 'utf8') > MAX_PREVIEW_CONTENT_BYTES) {
      return { ok: false, code: 'TOO_LARGE' };
    }
    return { ok: true, content };
  }

  private async failAll(
    source: SourceRef,
    pending: readonly PendingMailPreview[],
    code: MailPreviewFailureCode,
  ): Promise<MailPreviewSummary> {
    let summary = EMPTY_SUMMARY;
    for (const request of pending) {
      await this.deps.work.fail(source, request.requestId, code, this.deps.clock.now());
      summary = {
        ready: 0,
        failed: summary.failed + 1,
        unexpected: summary.unexpected + (code === 'UNEXPECTED' ? 1 : 0),
      };
    }
    return summary;
  }
}

function failureCodeOf(error: unknown): MailPreviewFailureCode {
  if (error instanceof MessageFetchError) return 'NOT_FOUND';
  if (error instanceof MimeParseError) return 'UNREADABLE';
  if (error instanceof MailboxConnectionError) return 'CONNECTION';
  return 'UNEXPECTED';
}

async function closeQuietly(session: MailboxSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Cerrar es lo último: un fallo aquí no debe tapar el resultado ya guardado.
  }
}
