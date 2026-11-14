import type { SecretContext } from '../../crypto/index.js';
import {
  MAX_PROCESSED_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  MILLISECONDS_PER_MINUTE,
} from './inbound-limits.js';

/**
 * Vida máxima, en la base de datos, del asunto o cuerpo de un correo traído para la vista previa
 * (odd/tasks/inbound-mail-delete.md, L11). Es una sola constante para las dos clases de contenido: el contenido
 * se borra además en cuanto se entrega. La visualización en el navegador no tiene límite propio.
 */
export const MAIL_PREVIEW_TTL_MINUTES = 15;
export const MAIL_PREVIEW_TTL_MS = MAIL_PREVIEW_TTL_MINUTES * MILLISECONDS_PER_MINUTE;

/** Clases de vista previa: el asunto solo confirma qué correo es; el cuerpo exige las condiciones de `reveal_reset`. */
export const MAIL_PREVIEW_KINDS = ['subject', 'body'] as const;
export type MailPreviewKind = (typeof MAIL_PREVIEW_KINDS)[number];

/**
 * Tope de bytes del contenido ya codificado en UTF-8. La columna cifrada admite 256 KiB incluida la etiqueta de
 * autenticación; con este tope sobra margen. Un contenido mayor NO se trunca (cortaría un código a la mitad):
 * se rechaza con `TOO_LARGE`.
 */
export const MAX_PREVIEW_CONTENT_BYTES = 200 * 1024;

/** Largo máximo, en caracteres, de cada clase antes de codificar; reutiliza los topes del procesamiento. */
export const MAX_PREVIEW_LENGTH: Readonly<Record<MailPreviewKind, number>> = {
  subject: MAX_SUBJECT_LENGTH,
  body: MAX_PROCESSED_BODY_LENGTH,
};

/** Nombre del campo en el contexto de cifrado (AAD) de la vista previa; distinto del de los códigos. */
export const MAIL_PREVIEW_FIELD = 'mail_preview';

/** La fila de la petición no se vuelve a sellar con otra versión de contexto. */
const MAIL_PREVIEW_CONTEXT_VERSION = 1;

/**
 * Contexto de cifrado de la vista previa. Lo comparten el worker (que cifra) y la API (que descifra al entregar).
 * El id de la petición forma parte del AAD: copiar el texto cifrado a otra petición u organización hace fallar el
 * descifrado.
 */
export function mailPreviewContext(
  organizationId: SecretContext['organizationId'],
  requestId: string,
): SecretContext {
  return {
    organizationId,
    resourceId: requestId,
    field: MAIL_PREVIEW_FIELD,
    version: MAIL_PREVIEW_CONTEXT_VERSION,
  };
}

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const DELETE = 0x7f;
const FIRST_C1_CONTROL = 0x80;
const LAST_C1_CONTROL = 0x9f;
/** Marcas de dirección de texto: reordenan lo que se ve y permiten disfrazar un asunto o un enlace. */
const FIRST_BIDI_EMBEDDING = 0x202a;
const LAST_BIDI_EMBEDDING = 0x202e;
const FIRST_BIDI_ISOLATE = 0x2066;
const LAST_BIDI_ISOLATE = 0x2069;
const LEFT_TO_RIGHT_MARK = 0x200e;
const RIGHT_TO_LEFT_MARK = 0x200f;
const ARABIC_LETTER_MARK = 0x061c;

function isDroppedCodePoint(codePoint: number, keepLineBreaks: boolean): boolean {
  if (codePoint === TAB) return false;
  if (codePoint === LINE_FEED || codePoint === CARRIAGE_RETURN) return !keepLineBreaks;
  if (codePoint < SPACE || codePoint === DELETE) return true;
  if (codePoint >= FIRST_C1_CONTROL && codePoint <= LAST_C1_CONTROL) return true;
  if (codePoint >= FIRST_BIDI_EMBEDDING && codePoint <= LAST_BIDI_EMBEDDING) return true;
  if (codePoint >= FIRST_BIDI_ISOLATE && codePoint <= LAST_BIDI_ISOLATE) return true;
  return (
    codePoint === LEFT_TO_RIGHT_MARK ||
    codePoint === RIGHT_TO_LEFT_MARK ||
    codePoint === ARABIC_LETTER_MARK
  );
}

/**
 * Deja solo texto que se pueda mostrar sin sorpresas: quita controles y marcas de dirección. El asunto va en una
 * sola línea (los saltos se vuelven espacios); el cuerpo conserva sus saltos de línea. No interpreta HTML ni
 * enlaces: la pantalla lo muestra siempre como texto.
 */
export function sanitizePreviewText(raw: string, kind: MailPreviewKind): string {
  const keepLineBreaks = kind === 'body';
  let cleaned = '';
  for (const character of raw) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (!keepLineBreaks && (codePoint === LINE_FEED || codePoint === CARRIAGE_RETURN)) {
      cleaned += ' ';
      continue;
    }
    if (isDroppedCodePoint(codePoint, keepLineBreaks)) continue;
    cleaned += character;
  }
  return kind === 'subject' ? cleaned.trim() : cleaned;
}
