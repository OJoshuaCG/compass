/**
 * Ejecuta las peticiones de borrado de correo de UNA fuente (ADR 0045, enmienda «borrado de correo a
 * petición»). Corre en el worker de sondeo, el único que descifra la contraseña del buzón; la API solo registra.
 *
 * Invariantes de seguridad
 * - Solo borra lo que una persona ya autorizó y auditó al pedirlo: nunca decide borrar por su cuenta.
 * - Antes de borrar compara el `UIDVALIDITY` guardado con el del buzón. Si difiere, los UID ya no apuntan a
 *   los mismos mensajes: se cierra con `POSITION_CHANGED` y NO se borra nada.
 * - Borra por UID, un mensaje por vez. El adaptador falla cerrado sin `UIDPLUS` (`UNSUPPORTED`), porque sin
 *   él borraría todo lo marcado como eliminado en el buzón.
 * - Solo `DELETED` cuando el servidor confirmó el borrado. Cualquier otra cosa cierra con un código acotado;
 *   la persona puede volver a pedirlo. Nunca se guarda texto del servidor ni se registra la contraseña.
 * - Si dos pasadas coinciden, la segunda recibe `NOT_FOUND` del servidor y su cierre no pisa el resultado de
 *   la primera (el cierre solo actúa sobre una fila pendiente).
 */
import type { Clock } from '../../../shared/kernel/index.js';
import type { MailConnectionLoader } from './ports/mail-connection-loader.js';
import type {
  MailDeleteResultCode,
  MailDeleteWorkStore,
  PendingMailDelete,
} from './ports/mail-delete-work-store.js';
import { MailboxConnectionError, MailboxDeleteUnsupportedError } from './ports/mailbox.js';
import type { MailboxWriteConnector, MailboxWriteSession } from './ports/mailbox.js';
import type { SourceRef } from './ports/poll-state-store.js';

/** Tope por fuente y pasada: cada borrado es una orden al buzón real; el resto espera a la siguiente. */
export const MAX_MAIL_DELETES_PER_SOURCE = 20;

export interface ExecuteMailDeleteRequestsDeps {
  readonly work: MailDeleteWorkStore;
  readonly connections: MailConnectionLoader;
  readonly mailbox: MailboxWriteConnector;
  readonly clock: Clock;
}

export interface MailDeleteSummary {
  readonly deleted: number;
  readonly failed: number;
  /** Cierres por un defecto (`UNEXPECTED`): el proceso debe salir con código distinto de cero. */
  readonly unexpected: number;
}

const EMPTY_SUMMARY: MailDeleteSummary = { deleted: 0, failed: 0, unexpected: 0 };

export class ExecuteMailDeleteRequests {
  constructor(private readonly deps: ExecuteMailDeleteRequestsDeps) {}

  async execute(source: SourceRef): Promise<MailDeleteSummary> {
    const { work, connections, mailbox } = this.deps;
    const pending = await work.listPending(source, MAX_MAIL_DELETES_PER_SOURCE);
    if (pending.length === 0) return EMPTY_SUMMARY;

    const loaded = await connections.load(source);
    if (!loaded.ok) {
      const code: MailDeleteResultCode =
        loaded.code === 'CONNECTION_MISSING' || loaded.code === 'PASSWORD_MISSING'
          ? 'CONNECTION_MISSING'
          : 'CONNECTION';
      return this.closeAll(source, pending, code);
    }

    let session: MailboxWriteSession;
    try {
      session = await mailbox.openForWrite(loaded.connection);
    } catch (error) {
      return this.closeAll(source, pending, openFailureCode(error));
    }

    try {
      return await this.deleteEach(source, session, pending);
    } finally {
      await closeQuietly(session);
    }
  }

  private async deleteEach(
    source: SourceRef,
    session: MailboxWriteSession,
    pending: readonly PendingMailDelete[],
  ): Promise<MailDeleteSummary> {
    let summary = EMPTY_SUMMARY;
    for (const request of pending) {
      const code = await this.deleteOne(session, request);
      await this.deps.work.close(source, request.requestId, code, this.deps.clock.now());
      summary = addToSummary(summary, code);
      // Tras un defecto la sesión puede estar en mal estado: lo que falta se reintenta en la siguiente pasada.
      if (code === 'UNEXPECTED') break;
    }
    return summary;
  }

  private async deleteOne(
    session: MailboxWriteSession,
    request: PendingMailDelete,
  ): Promise<MailDeleteResultCode> {
    if (session.uidValidity !== request.mailboxUidValidity) return 'POSITION_CHANGED';
    try {
      const outcome = await session.deleteMessage(request.mailboxUid);
      return outcome === 'deleted' ? 'DELETED' : 'NOT_FOUND';
    } catch (error) {
      return error instanceof MailboxConnectionError ? 'CONNECTION' : 'UNEXPECTED';
    }
  }

  private async closeAll(
    source: SourceRef,
    pending: readonly PendingMailDelete[],
    code: MailDeleteResultCode,
  ): Promise<MailDeleteSummary> {
    let summary = EMPTY_SUMMARY;
    for (const request of pending) {
      await this.deps.work.close(source, request.requestId, code, this.deps.clock.now());
      summary = addToSummary(summary, code);
    }
    return summary;
  }
}

function openFailureCode(error: unknown): MailDeleteResultCode {
  if (error instanceof MailboxDeleteUnsupportedError) return 'UNSUPPORTED';
  if (error instanceof MailboxConnectionError) return 'CONNECTION';
  return 'UNEXPECTED';
}

function addToSummary(summary: MailDeleteSummary, code: MailDeleteResultCode): MailDeleteSummary {
  return {
    deleted: summary.deleted + (code === 'DELETED' ? 1 : 0),
    failed: summary.failed + (code === 'DELETED' ? 0 : 1),
    unexpected: summary.unexpected + (code === 'UNEXPECTED' ? 1 : 0),
  };
}

async function closeQuietly(session: MailboxWriteSession): Promise<void> {
  try {
    await session.close();
  } catch {
    // Cerrar es lo último: un fallo aquí no debe tapar el resultado ya guardado.
  }
}
