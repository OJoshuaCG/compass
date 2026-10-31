/**
 * Extracción de códigos y enlaces del cuerpo de un mensaje (ADR 0045 sección 7, IC-1).
 *
 * Sin expresiones regulares: solo `indexOf`, comparación de caracteres y el analizador `URL`. El cuerpo
 * es texto del atacante (aunque el remitente sea legítimo, el mensaje puede incluir texto que él
 * controla), así que cualquier ambigüedad falla cerrada: si hay dos candidatos distintos no se devuelve
 * ninguno.
 */
import { isAsciiDigitCode, isAsciiLetterOrDigitCode } from './ascii-text.js';
import { MAX_LINK_LENGTH, MAX_PROCESSED_BODY_LENGTH } from './inbound-limits.js';
import type { AllowedLinkRule, FixedLengthCodeRule } from './inbound-template.js';

export type ExtractionOutcome =
  | { readonly found: true; readonly value: string }
  | { readonly found: false; readonly reason: 'NOT_FOUND' | 'AMBIGUOUS' | 'BODY_TOO_LARGE' };

const NOT_FOUND: ExtractionOutcome = { found: false, reason: 'NOT_FOUND' };
const AMBIGUOUS: ExtractionOutcome = { found: false, reason: 'AMBIGUOUS' };
const BODY_TOO_LARGE: ExtractionOutcome = { found: false, reason: 'BODY_TOO_LARGE' };

const LINK_SCHEME_PREFIX = 'https://';
const HTTPS_PROTOCOL = 'https:';
/** Caracteres que terminan un enlace candidato dentro del texto (además de espacios, controles y no ASCII). */
const LINK_TERMINATING_CHARACTERS = '<>"\'`()[]{}\\|^';
const CODE_SPACE = 32;
const CODE_DELETE = 127;

function isCodeCharacter(code: number, charset: FixedLengthCodeRule['charset']): boolean {
  return charset === 'digits' ? isAsciiDigitCode(code) : isAsciiLetterOrDigitCode(code);
}

/** Todos los caracteres desde `start` hasta `start + length` pertenecen al juego de caracteres. */
function isRunOfCodeCharacters(
  body: string,
  start: number,
  length: number,
  charset: FixedLengthCodeRule['charset'],
): boolean {
  if (start + length > body.length) return false;
  for (let index = start; index < start + length; index += 1) {
    if (!isCodeCharacter(body.charCodeAt(index), charset)) return false;
  }
  return true;
}

/**
 * Devuelve el código solo si el literal de arranque, exactamente `codeLength` caracteres del juego y el
 * literal de cierre aparecen juntos. El carácter que sigue al código no puede pertenecer al juego: así un
 * código de 8 dígitos nunca produce uno de 6. Si el patrón aparece más de una vez con códigos distintos
 * el resultado es ambiguo y no se devuelve nada.
 */
export function extractFixedLengthCode(body: string, rule: FixedLengthCodeRule): ExtractionOutcome {
  if (body.length > MAX_PROCESSED_BODY_LENGTH) return BODY_TOO_LARGE;
  if (rule.leadingLiteral.length === 0) return NOT_FOUND;

  const foundCodes = new Set<string>();
  let searchFrom = 0;
  while (searchFrom <= body.length) {
    const literalIndex = body.indexOf(rule.leadingLiteral, searchFrom);
    if (literalIndex === -1) break;
    searchFrom = literalIndex + 1;

    const codeStart = literalIndex + rule.leadingLiteral.length;
    const codeEnd = codeStart + rule.codeLength;
    if (!isRunOfCodeCharacters(body, codeStart, rule.codeLength, rule.charset)) continue;

    const hasMoreCodeCharacters =
      codeEnd < body.length && isCodeCharacter(body.charCodeAt(codeEnd), rule.charset);
    if (hasMoreCodeCharacters) continue;
    if (!body.startsWith(rule.trailingLiteral, codeEnd)) continue;

    foundCodes.add(body.slice(codeStart, codeEnd));
  }

  if (foundCodes.size === 0) return NOT_FOUND;
  if (foundCodes.size > 1) return AMBIGUOUS;
  const [onlyCode] = foundCodes;
  return onlyCode === undefined ? NOT_FOUND : { found: true, value: onlyCode };
}

function isLinkTerminator(code: number, character: string): boolean {
  const isControlOrSpace = code <= CODE_SPACE || code >= CODE_DELETE;
  return isControlOrSpace || LINK_TERMINATING_CHARACTERS.includes(character);
}

/**
 * Texto del enlace candidato que empieza en `start`, hasta el primer terminador. La lectura se detiene un
 * carácter después del tope: un cuerpo hostil de `https://` repetidos sin separadores haría que cada
 * candidato recorriera el resto del cuerpo (coste cuadrático). Un candidato más largo que el tope se
 * descarta igual en `normalizeAllowedLink`.
 */
function readLinkCandidate(body: string, start: number): string {
  const readLimit = Math.min(body.length, start + MAX_LINK_LENGTH + 1);
  let end = start;
  while (end < readLimit && !isLinkTerminator(body.charCodeAt(end), body.charAt(end))) {
    end += 1;
  }
  return body.slice(start, end);
}

/**
 * Interpreta el candidato con el mismo analizador que usará el navegador para abrirlo (así no hay
 * diferencias de interpretación, por ejemplo con `\` o `@`) y devuelve el enlace normalizado solo si
 * cumple la regla. Nunca lanza.
 */
function normalizeAllowedLink(candidate: string, rule: AllowedLinkRule): string | null {
  if (candidate.length > MAX_LINK_LENGTH) return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== HTTPS_PROTOCOL) return null;
  // Credenciales en el enlace (`https://permitido.com@atacante.com`) y puertos no se admiten.
  if (parsedUrl.username !== '' || parsedUrl.password !== '' || parsedUrl.port !== '') return null;
  if (!rule.allowedHosts.includes(parsedUrl.hostname)) return null;
  if (!parsedUrl.pathname.startsWith(rule.pathPrefix)) return null;
  return parsedUrl.href;
}

/**
 * Devuelve un enlace solo si su anfitrión está en la lista de la plantilla; un enlace de cualquier otro
 * anfitrión no se devuelve nunca. Varios enlaces permitidos y distintos son ambiguos (un texto del
 * atacante podría haber añadido uno).
 */
export function extractAllowedLink(body: string, rule: AllowedLinkRule): ExtractionOutcome {
  if (body.length > MAX_PROCESSED_BODY_LENGTH) return BODY_TOO_LARGE;

  const allowedLinks = new Set<string>();
  let searchFrom = 0;
  while (searchFrom <= body.length) {
    const schemeIndex = body.indexOf(LINK_SCHEME_PREFIX, searchFrom);
    if (schemeIndex === -1) break;
    searchFrom = schemeIndex + LINK_SCHEME_PREFIX.length;

    const candidate = readLinkCandidate(body, schemeIndex);
    const allowedLink = normalizeAllowedLink(candidate, rule);
    if (allowedLink !== null) allowedLinks.add(allowedLink);
  }

  if (allowedLinks.size === 0) return NOT_FOUND;
  if (allowedLinks.size > 1) return AMBIGUOUS;
  const [onlyLink] = allowedLinks;
  return onlyLink === undefined ? NOT_FOUND : { found: true, value: onlyLink };
}
