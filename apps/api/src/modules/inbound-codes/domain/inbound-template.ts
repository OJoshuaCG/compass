/**
 * Plantillas de mensajes entrantes (ADR 0045 sección 1 y 7, IC-1).
 *
 * Una plantilla vive en el catálogo de plataforma y solo usa operaciones sin retroceso: remitente exacto,
 * asunto por igualdad o prefijo y extracción de largo fijo (o enlace de un anfitrión permitido). NINGÚN
 * campo se interpreta como expresión regular, de modo que no existe ReDoS por patrones de usuario.
 */
import { isAsciiLetterOrDigitCode, isVisibleAsciiOnly, toAsciiLowercase } from './ascii-text.js';
import {
  MAX_ALLOWED_LINK_HOSTS,
  MAX_CODE_LENGTH,
  MAX_HOSTNAME_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TEMPLATE_LITERAL_LENGTH,
  MIN_CODE_LENGTH,
} from './inbound-limits.js';
import { isWellFormedDomain, normalizeEmailAddress } from './mail-address.js';

export const INBOUND_ITEM_KINDS = ['login_code', 'reset_code', 'reset_link'] as const;
export type InboundItemKind = (typeof INBOUND_ITEM_KINDS)[number];

export type SubjectRule =
  | { readonly mode: 'equals'; readonly value: string }
  | { readonly mode: 'prefix'; readonly value: string };

export type CodeCharset = 'digits' | 'alphanumeric';

/** Código de largo fijo entre un literal de arranque y, opcionalmente, un literal de cierre. */
export interface FixedLengthCodeRule {
  readonly type: 'fixed_length_code';
  /** Texto que precede al código; ancla obligatoria (no puede ser vacío). */
  readonly leadingLiteral: string;
  readonly codeLength: number;
  readonly charset: CodeCharset;
  /** Texto que debe seguir inmediatamente al código; vacío = el código debe terminar en un borde. */
  readonly trailingLiteral: string;
}

/** Enlace `https` cuyo anfitrión está en una lista exacta (sin comodines) y cuya ruta empieza por un prefijo. */
export interface AllowedLinkRule {
  readonly type: 'allowed_host_link';
  readonly allowedHosts: readonly string[];
  readonly pathPrefix: string;
}

export type ExtractionRule = FixedLengthCodeRule | AllowedLinkRule;

export interface InboundTemplate {
  readonly id: string;
  readonly kind: InboundItemKind;
  /** Remitente exacto (se compara por igualdad tras la normalización de `mail-address.ts`). */
  readonly senderAddress: string;
  /** `null` = no se filtra por asunto. */
  readonly subject: SubjectRule | null;
  readonly extraction: ExtractionRule;
}

export const TEMPLATE_PROBLEMS = [
  'INVALID_SENDER',
  'INVALID_SUBJECT_RULE',
  'INVALID_LEADING_LITERAL',
  'INVALID_TRAILING_LITERAL',
  'INVALID_CODE_LENGTH',
  'UNKNOWN_CHARSET',
  'INVALID_ALLOWED_HOSTS',
  'INVALID_PATH_PREFIX',
  'UNKNOWN_EXTRACTION_TYPE',
  'UNKNOWN_KIND',
  'KIND_EXTRACTION_MISMATCH',
] as const;
export type TemplateProblem = (typeof TEMPLATE_PROBLEMS)[number];

/**
 * Problemas que NO impiden evaluar la plantilla: la clasificación los trata fallando cerrado (el
 * elemento es sensible), de modo que seguir evaluando es seguro y descartarla permitiría que otra
 * plantilla del mismo mensaje hiciera visible lo que esta marcaba como sensible.
 */
const CLASSIFICATION_ONLY_PROBLEMS: ReadonlySet<TemplateProblem> = new Set([
  'UNKNOWN_KIND',
  'KIND_EXTRACTION_MISMATCH',
]);

function isLiteralWithinBounds(literal: string): boolean {
  return literal.length <= MAX_TEMPLATE_LITERAL_LENGTH;
}

function isValidHostPattern(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOSTNAME_LENGTH) return false;
  if (!isVisibleAsciiOnly(host) || host !== toAsciiLowercase(host)) return false;
  // Sin comodines, puertos, rutas ni credenciales: solo etiquetas de anfitrión.
  for (let index = 0; index < host.length; index += 1) {
    const isHyphenOrDot = host.charAt(index) === '-' || host.charAt(index) === '.';
    if (!isAsciiLetterOrDigitCode(host.charCodeAt(index)) && !isHyphenOrDot) return false;
  }
  return isWellFormedDomain(host);
}

function isCodeRule(rule: { readonly type: string }): rule is FixedLengthCodeRule {
  return rule.type === 'fixed_length_code';
}

function isLinkRule(rule: { readonly type: string }): rule is AllowedLinkRule {
  return rule.type === 'allowed_host_link';
}

/** Lista de problemas de una plantilla; vacía si está bien formada. Úsala al guardar en el catálogo. */
export function findTemplateProblems(template: InboundTemplate): readonly TemplateProblem[] {
  const problems: TemplateProblem[] = [];

  if (normalizeEmailAddress(template.senderAddress) === null) problems.push('INVALID_SENDER');

  if (template.subject !== null) {
    const subjectRule = template.subject;
    // Los datos del catálogo pueden traer valores fuera del tipo: se comparan como texto.
    const declaredMode: string = subjectRule.mode;
    const isKnownMode = declaredMode === 'equals' || declaredMode === 'prefix';
    const hasUsableValue =
      subjectRule.value.length > 0 && subjectRule.value.length <= MAX_SUBJECT_LENGTH;
    if (!isKnownMode || !hasUsableValue) problems.push('INVALID_SUBJECT_RULE');
  }

  if (!(INBOUND_ITEM_KINDS as readonly string[]).includes(template.kind)) {
    problems.push('UNKNOWN_KIND');
  }

  const extraction = template.extraction;
  if (isCodeRule(extraction)) {
    if (
      extraction.leadingLiteral.length === 0 ||
      !isLiteralWithinBounds(extraction.leadingLiteral)
    ) {
      problems.push('INVALID_LEADING_LITERAL');
    }
    if (!isLiteralWithinBounds(extraction.trailingLiteral)) {
      problems.push('INVALID_TRAILING_LITERAL');
    }
    const hasValidLength =
      Number.isInteger(extraction.codeLength) &&
      extraction.codeLength >= MIN_CODE_LENGTH &&
      extraction.codeLength <= MAX_CODE_LENGTH;
    if (!hasValidLength) problems.push('INVALID_CODE_LENGTH');
    const declaredCharset: string = extraction.charset;
    if (declaredCharset !== 'digits' && declaredCharset !== 'alphanumeric') {
      problems.push('UNKNOWN_CHARSET');
    }
    if (template.kind === 'reset_link') problems.push('KIND_EXTRACTION_MISMATCH');
  } else if (isLinkRule(extraction)) {
    const hosts = extraction.allowedHosts;
    const hostsAreValid =
      hosts.length > 0 &&
      hosts.length <= MAX_ALLOWED_LINK_HOSTS &&
      hosts.every((host) => isValidHostPattern(host));
    if (!hostsAreValid) problems.push('INVALID_ALLOWED_HOSTS');
    const prefix = extraction.pathPrefix;
    const hasValidPrefix =
      prefix.startsWith('/') && isLiteralWithinBounds(prefix) && isVisibleAsciiOnly(prefix);
    if (!hasValidPrefix) problems.push('INVALID_PATH_PREFIX');
    if (template.kind !== 'reset_link') problems.push('KIND_EXTRACTION_MISMATCH');
  } else {
    problems.push('UNKNOWN_EXTRACTION_TYPE');
  }

  return problems;
}

/**
 * `true` si la plantilla se puede evaluar con los topes respetados. Una plantilla con un problema
 * estructural (literal enorme, largo absurdo, remitente inválido) no coincide con nada: no se interpreta.
 */
export function isTemplateEvaluable(template: InboundTemplate): boolean {
  return findTemplateProblems(template).every((problem) =>
    CLASSIFICATION_ONLY_PROBLEMS.has(problem),
  );
}

/**
 * Coincidencia de remitente y asunto, solo con igualdad y prefijo. `normalizedSender` es la dirección
 * `From` que devolvió la compuerta DKIM (ya normalizada y de firma alineada).
 */
export function templateMatchesEnvelope(
  template: InboundTemplate,
  normalizedSender: string,
  subject: string | null,
): boolean {
  const templateSender = normalizeEmailAddress(template.senderAddress);
  if (templateSender === null || templateSender.address !== normalizedSender) return false;

  if (template.subject === null) return true;
  if (subject === null || subject.length > MAX_SUBJECT_LENGTH) return false;
  if (template.subject.mode === 'equals') return subject === template.subject.value;
  return subject.startsWith(template.subject.value);
}
