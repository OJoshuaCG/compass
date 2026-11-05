import type { DkimSignatureEvidence, HeaderCounts } from '../domain/dkim-gate.js';
import type {
  AuthenticityAssessment,
  AuthenticityVerdicts,
  AuthenticityVerifier,
  MailHeader,
  ParsedMail,
} from '../application/ports/mime-and-authenticity.js';

const AUTHENTICATION_RESULTS_HEADER = 'authentication-results';
const DKIM_SIGNATURE_HEADER = 'dkim-signature';
/** La cabecera que antepone el MTA propio es la primera del mensaje (posición 0). */
const OWN_MTA_HEADER_POSITION = 0;
/** `header.b` del veredicto es un prefijo de la firma; por debajo de esto no identifica una firma. */
const MIN_SIGNATURE_PREFIX_LENGTH = 6;
/** Un veredicto (`pass`, `fail`, `none`...) es una palabra corta; lo demás lo controla el remitente. */
const MAX_VERDICT_LENGTH = 16;
const VERDICT_PATTERN = /^[a-z]+$/;
const SIGNATURE_PREFIX_PATTERN = /^[A-Za-z0-9+/=]+$/;
const MILLISECONDS_PER_SECOND = 1000;

interface ResultEntry {
  readonly method: string;
  readonly result: string;
  readonly properties: ReadonlyMap<string, string>;
}

interface ParsedAuthenticationResults {
  readonly authservId: string;
  readonly entries: readonly ResultEntry[];
}

/**
 * Fase 1 del ADR 0045: no se verifica DKIM en el worker, se confía en la `Authentication-Results` que
 * antepone el servidor propio. Por eso la regla falla cerrado ante cualquier ambigüedad: el `authserv-id`
 * no es secreto, así que una cabecera ajena igual de bien formada no puede ser tomada por la propia.
 */
export class AuthenticationResultsVerifier implements AuthenticityVerifier {
  assess(
    mail: ParsedMail,
    context: { readonly authservId: string; readonly fromAddress: string | null },
  ): AuthenticityAssessment {
    const expectedAuthservId = context.authservId.trim().toLowerCase();

    const ownResults = mail.relevantHeaders
      .filter((header) => header.name === AUTHENTICATION_RESULTS_HEADER)
      .map((header) => ({ header, parsed: parseAuthenticationResults(header.value) }))
      .filter((candidate) => candidate.parsed?.authservId === expectedAuthservId);

    const [onlyOwn] = ownResults;
    if (
      ownResults.length !== 1 ||
      onlyOwn === undefined ||
      onlyOwn.parsed === null ||
      onlyOwn.header.position !== OWN_MTA_HEADER_POSITION
    ) {
      return { ok: false, reason: 'AUTH_RESULTS_AMBIGUOUS' };
    }

    const verdicts = collectVerdicts(onlyOwn.parsed.entries);
    const fromDomain = extractDomain(context.fromAddress);
    if (fromDomain === null) return { ok: true, validatedSignatures: [], verdicts };

    const alignedPasses = onlyOwn.parsed.entries.filter(
      (entry) =>
        entry.method === 'dkim' &&
        entry.result === 'pass' &&
        entry.properties.get('header.d')?.toLowerCase() === fromDomain,
    );
    if (alignedPasses.length === 0) return { ok: true, validatedSignatures: [], verdicts };
    const [onlyPass] = alignedPasses;
    if (alignedPasses.length > 1 || onlyPass === undefined) {
      return { ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' };
    }

    const evidence = pickSingleSignature(onlyPass, mail.relevantHeaders, fromDomain);
    if (evidence === null) return { ok: false, reason: 'DKIM_SIGNATURE_AMBIGUOUS' };
    return { ok: true, validatedSignatures: [evidence], verdicts };
  }
}

/**
 * Parte el valor en segmentos (separados por `;`) y tokens (separados por espacio) respetando las cadenas
 * entrecomilladas y los comentarios de RFC 5322. Un `;`, un espacio o un `(` dentro de comillas es dato,
 * no estructura: si el servidor copia texto del remitente (`smtp.mailfrom`, `header.i`, `reason`), este no
 * puede fabricar un resultado `dkim=pass` ni tragarse el resto de la cabecera. `null` si hay comillas o
 * comentarios sin cerrar: una cabecera que no se puede leer sin ambigüedad no vale.
 */
function tokenizeResults(value: string): string[][] | null {
  const segments: string[][] = [[]];
  let token = '';
  let inQuotes = false;
  let commentDepth = 0;
  let escaped = false;

  const endToken = (): void => {
    if (token === '') return;
    segments[segments.length - 1]?.push(token);
    token = '';
  };

  for (const character of value) {
    if (inQuotes) {
      token += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inQuotes = false;
    } else if (commentDepth > 0) {
      if (character === '(') commentDepth += 1;
      else if (character === ')') commentDepth -= 1;
    } else if (character === '"') {
      inQuotes = true;
      token += character;
    } else if (character === '(') {
      commentDepth = 1;
      // Un comentario separa tokens: `a(x)b` son dos.
      endToken();
    } else if (character === ';') {
      endToken();
      segments.push([]);
    } else if (/\s/.test(character)) {
      endToken();
    } else {
      token += character;
    }
  }
  if (inQuotes || commentDepth > 0) return null;
  endToken();
  return segments;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseAuthenticationResults(rawValue: string): ParsedAuthenticationResults | null {
  const segments = tokenizeResults(rawValue);
  if (segments === null) return null;
  const [authservSegment, ...resultSegments] = segments;
  // `authserv-id [versión]`: la versión opcional se ignora.
  const authservToken = authservSegment?.[0];
  if (authservToken === undefined) return null;

  const entries: ResultEntry[] = [];
  for (const tokens of resultSegments) {
    const [methodAndResult, ...propertyTokens] = tokens;
    if (methodAndResult === undefined) continue;
    const separatorIndex = methodAndResult.indexOf('=');
    if (separatorIndex <= 0) continue;

    const properties = new Map<string, string>();
    for (const propertyToken of propertyTokens) {
      const propertySeparator = propertyToken.indexOf('=');
      if (propertySeparator <= 0) continue;
      const propertyName = propertyToken.slice(0, propertySeparator).toLowerCase();
      // Una propiedad repetida no se resuelve a favor de la última: se queda la primera.
      if (!properties.has(propertyName)) {
        properties.set(propertyName, stripQuotes(propertyToken.slice(propertySeparator + 1)));
      }
    }
    entries.push({
      method: methodAndResult.slice(0, separatorIndex).toLowerCase(),
      result: methodAndResult.slice(separatorIndex + 1).toLowerCase(),
      properties,
    });
  }
  return { authservId: authservToken.toLowerCase(), entries };
}

function boundedVerdict(value: string | undefined): string | null {
  if (value === undefined || value.length > MAX_VERDICT_LENGTH) return null;
  return VERDICT_PATTERN.test(value) ? value : null;
}

/** Si un método aparece varias veces se reporta `pass` cuando alguno pasó; si no, el primero. */
function collectVerdicts(entries: readonly ResultEntry[]): AuthenticityVerdicts {
  const verdictFor = (method: string): string | null => {
    const results = entries.filter((entry) => entry.method === method).map((entry) => entry.result);
    return boundedVerdict(results.includes('pass') ? 'pass' : results[0]);
  };
  return { spf: verdictFor('spf'), dkim: verdictFor('dkim'), dmarc: verdictFor('dmarc') };
}

function extractDomain(address: string | null): string | null {
  if (address === null) return null;
  const atIndex = address.lastIndexOf('@');
  if (atIndex < 0 || atIndex === address.length - 1) return null;
  return address.slice(atIndex + 1).toLowerCase();
}

/**
 * Identifica la firma del veredicto por `header.b` (prefijo), `d=` y `s=`. Debe haber exactamente una:
 * una firma falsa e inválida con el mismo `d=` y `s=` podría declarar `h=` sobrefirmado y sin `l=`.
 */
function pickSingleSignature(
  verdict: ResultEntry,
  headers: readonly MailHeader[],
  fromDomain: string,
): DkimSignatureEvidence | null {
  const selector = verdict.properties.get('header.s')?.toLowerCase();
  const signaturePrefix = verdict.properties.get('header.b');
  if (
    selector === undefined ||
    signaturePrefix === undefined ||
    signaturePrefix.length < MIN_SIGNATURE_PREFIX_LENGTH ||
    !SIGNATURE_PREFIX_PATTERN.test(signaturePrefix)
  ) {
    return null;
  }

  const matches: DkimSignatureEvidence[] = [];
  for (const header of headers) {
    if (header.name !== DKIM_SIGNATURE_HEADER) continue;
    const tags = parseSignatureTags(header.value);
    if (tags === null) {
      // Una firma con etiquetas repetidas es inválida (RFC 6376): no se puede descartar que sea la candidata.
      return null;
    }
    const matchesVerdict =
      tags.get('d')?.toLowerCase() === fromDomain &&
      tags.get('s')?.toLowerCase() === selector &&
      (tags.get('b') ?? '').startsWith(signaturePrefix);
    if (matchesVerdict) matches.push(buildEvidence(tags, fromDomain));
  }
  const [onlyMatch] = matches;
  return matches.length === 1 && onlyMatch !== undefined ? onlyMatch : null;
}

/** `null` si alguna etiqueta se repite. Los espacios de plegado se quitan de `b=` y `h=`. */
function parseSignatureTags(rawValue: string): ReadonlyMap<string, string> | null {
  const tags = new Map<string, string>();
  for (const part of rawValue.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) continue;
    const tagName = part.slice(0, separatorIndex).trim().toLowerCase();
    if (tagName === '') continue;
    if (tags.has(tagName)) return null;
    tags.set(tagName, part.slice(separatorIndex + 1).replace(/\s+/g, ''));
  }
  return tags;
}

const EPOCH = new Date(0);

/** `null` solo si la etiqueta no viene; una ilegible se lee como el origen de la época. */
function parseUnixSeconds(value: string | undefined): Date | null {
  if (value === undefined) return null;
  if (!/^\d{1,15}$/.test(value)) return EPOCH;
  return new Date(Number(value) * MILLISECONDS_PER_SECOND);
}

function countSignedHeaders(headerList: string | undefined): HeaderCounts {
  const counts = { from: 0, to: 0, subject: 0, date: 0 };
  for (const name of (headerList ?? '').toLowerCase().split(':')) {
    if (name === 'from') counts.from += 1;
    else if (name === 'to') counts.to += 1;
    else if (name === 'subject') counts.subject += 1;
    else if (name === 'date') counts.date += 1;
  }
  return counts;
}

function buildEvidence(
  tags: ReadonlyMap<string, string>,
  signingDomain: string,
): DkimSignatureEvidence {
  return {
    signingDomain,
    signedHeaderCounts: countSignedHeaders(tags.get('h')),
    hasBodyLengthLimit: tags.has('l'),
    // `x=` ilegible queda en la época, es decir, ya vencida: nunca se lee como "sin expiración".
    signedAt: parseUnixSeconds(tags.get('t')),
    expiresAt: parseUnixSeconds(tags.get('x')),
    // El veredicto del servidor no trae el tamaño de la clave: solo este adaptador lo declara así.
    keyBits: 0,
    keyBitsPolicy: 'not_available',
  };
}
