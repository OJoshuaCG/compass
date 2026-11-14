/**
 * Registro por mensaje del sondeo (ADR 0045, "Registro para validar DKIM en la fase 2"): una línea JSON por
 * mensaje con los identificadores opacos y los veredictos acotados. NUNCA escribe asunto, cuerpo,
 * direcciones, código ni enlace: el esquema de la línea es cerrado y lo fija este archivo, no el mensaje.
 */
import type {
  PollMessageRecord,
  PollObserver,
  PollSignatureRecord,
} from '../application/poll-mail-source.js';

/** Longitud máxima de un nombre DNS (RFC 1035): lo que el mensaje declare no puede abultar ni forjar la línea. */
const MAX_DNS_NAME_LENGTH = 253;
const DNS_NAME_PATTERN = /^[a-z0-9._-]+$/;

/** El dominio y el selector vienen del mensaje: solo se escriben si tienen forma de nombre DNS. */
function sanitizeDnsName(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > MAX_DNS_NAME_LENGTH) return null;
  const normalized = value.toLowerCase();
  return DNS_NAME_PATTERN.test(normalized) ? normalized : null;
}

/**
 * `aligned` vale `true` siempre que hay firma: el verificador solo entrega una firma cuyo `d=` coincide con el
 * dominio del `From` (alineación estricta). Sin firma validada no hay nada que alinear y todo va en `null`.
 */
function signatureFields(signature: PollSignatureRecord | null) {
  return {
    signingDomain: sanitizeDnsName(signature?.signingDomain ?? null),
    selector: sanitizeDnsName(signature?.selector ?? null),
    aligned: signature === null ? null : true,
    bodyLengthLimit: signature?.hasBodyLengthLimit ?? null,
    signedHeaders: signature?.signedHeaderCounts ?? null,
  };
}

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
        ...signatureFields(record.signature),
      }),
    );
  }
}
