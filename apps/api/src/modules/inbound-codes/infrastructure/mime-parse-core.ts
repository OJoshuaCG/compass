import PostalMime from 'postal-mime';

import type { MailHeader, ParsedMail } from '../application/ports/mime-and-authenticity.js';

/** Forma serializable del resultado: la fecha viaja como texto ISO porque cruza un proceso por JSON. */
export interface SerializedParsedMail extends Omit<ParsedMail, 'dateHeader'> {
  readonly dateHeader: string | null;
}

const RELEVANT_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authentication-results',
  'dkim-signature',
]);
/** Topes propios de la biblioteca: un mensaje hostil que los supere se rechaza en lugar de agotar memoria. */
const MAX_NESTING_DEPTH = 16;
const MAX_HEADERS_SIZE_BYTES = 256 * 1024;
const MAX_PART_COUNT = 200;

/** Lanzado cuando el contenido no se pudo analizar; el proceso padre lo traduce a `MimeParseError`. */
export async function parseRawMessage(rawMessage: Uint8Array): Promise<SerializedParsedMail> {
  const email = await PostalMime.parse(rawMessage, {
    // Los adjuntos no se usan; el tope de 256 KB del mensaje y el del hijo acotan su costo en memoria.
    attachmentEncoding: 'utf8',
    maxNestingDepth: MAX_NESTING_DEPTH,
    maxHeadersSize: MAX_HEADERS_SIZE_BYTES,
    maxPartCount: MAX_PART_COUNT,
  });

  const relevantHeaders: MailHeader[] = [];
  const instanceCounts = { from: 0, to: 0, subject: 0, date: 0 };
  for (const [position, header] of email.headers.entries()) {
    if (RELEVANT_HEADER_NAMES.has(header.key)) {
      relevantHeaders.push({ name: header.key, value: header.value, position });
    }
    if (header.key === 'from') instanceCounts.from += 1;
    else if (header.key === 'to') instanceCounts.to += 1;
    else if (header.key === 'subject') instanceCounts.subject += 1;
    else if (header.key === 'date') instanceCounts.date += 1;
  }

  const toAddresses = (email.to ?? [])
    .flatMap((entry) => (entry.group === undefined ? [entry] : entry.group))
    .map((mailbox) => mailbox.address.toLowerCase())
    .filter((address) => address !== '');

  return {
    fromAddress: email.from === undefined ? null : nullIfEmpty(firstAddress(email.from)),
    toAddresses,
    subject: email.subject ?? null,
    dateHeader: toIsoDate(email.date),
    headerInstanceCounts: instanceCounts,
    relevantHeaders,
    bodyText: plainTextOnly(email, topLevelContentType(email.headers)),
  };
}

function nullIfEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function topLevelContentType(headers: readonly { key: string; value: string }[]): string {
  return (
    headers
      .find((header) => header.key === 'content-type')
      ?.value.trim()
      .toLowerCase() ?? ''
  );
}

/**
 * postal-mime arma `text` a partir de las partes HTML cuando no hay una alternativa de texto plano para
 * ellas (por ejemplo `multipart/mixed` con una parte `text/plain` y otra `text/html`): el texto oculto del
 * HTML (`display:none`) acabaría en el cuerpo que lee el extractor de códigos. Falla cerrado: si el mensaje
 * trae HTML, solo se acepta el texto cuando el nivel superior es `multipart/alternative`, donde `text` sale
 * únicamente de las partes de texto plano. Un `mixed` que anida una alternativa pierde el cuerpo (no se
 * extrae código), lo que es seguro y se acepta como limitación.
 */
function plainTextOnly(
  email: { html?: string | undefined; text?: string | undefined },
  contentType: string,
): string {
  if (email.html !== undefined && !contentType.startsWith('multipart/alternative')) return '';
  return email.text ?? '';
}

function firstAddress(
  address: NonNullable<Awaited<ReturnType<typeof PostalMime.parse>>['from']>,
): string | undefined {
  const mailbox = address.group === undefined ? address : address.group[0];
  return mailbox?.address.toLowerCase();
}

function toIsoDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
