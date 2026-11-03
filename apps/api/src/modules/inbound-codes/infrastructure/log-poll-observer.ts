/**
 * Registro por mensaje del sondeo (ADR 0045, "Registro para validar DKIM en la fase 2"): una línea JSON por
 * mensaje con los identificadores opacos y los veredictos acotados. NUNCA escribe asunto, cuerpo,
 * direcciones, código ni enlace: el esquema de la línea es cerrado y lo fija este archivo, no el mensaje.
 */
import type { PollMessageRecord, PollObserver } from '../application/poll-mail-source.js';

export class LogPollObserver implements PollObserver {
  constructor(private readonly write: (line: string) => void) {}

  messageHandled(record: PollMessageRecord): void {
    this.write(
      JSON.stringify({
        event: 'inbound.message',
        sourceId: record.sourceId,
        fingerprint: record.fingerprint,
        outcome: record.outcome,
        reason: record.reason,
        spf: record.verdicts?.spf ?? null,
        dkim: record.verdicts?.dkim ?? null,
        dmarc: record.verdicts?.dmarc ?? null,
      }),
    );
  }
}
