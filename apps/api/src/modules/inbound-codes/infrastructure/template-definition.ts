import type {
  ExtractionRule,
  InboundItemKind,
  InboundTemplate,
  SubjectRule,
} from '../domain/inbound-template.js';
import { INBOUND_ITEM_KINDS, isTemplateEvaluable } from '../domain/inbound-template.js';

/**
 * Convierte una fila de `inbound_templates` en la plantilla del dominio. La columna `definition` guarda
 * `{ senderAddress, subject, extraction }` con la misma forma que `InboundTemplate` (sin `id` ni `kind`,
 * que son columnas). Falla cerrado: una definición que no se entienda por completo, o que el dominio no
 * pueda evaluar, devuelve `null` y la plantilla simplemente no coincide con nada.
 */
export function parseTemplateRow(row: {
  readonly id: string;
  readonly kind: string;
  readonly definition: unknown;
}): InboundTemplate | null {
  if (!isItemKind(row.kind) || !isRecord(row.definition)) return null;
  const { senderAddress, subject, extraction } = row.definition;
  if (typeof senderAddress !== 'string') return null;
  const parsedSubject = parseSubject(subject);
  const parsedExtraction = parseExtraction(extraction);
  if (parsedSubject === undefined || parsedExtraction === null) return null;

  const template: InboundTemplate = {
    id: row.id,
    kind: row.kind,
    senderAddress,
    subject: parsedSubject,
    extraction: parsedExtraction,
  };
  return isTemplateEvaluable(template) ? template : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isItemKind(value: string): value is InboundItemKind {
  return (INBOUND_ITEM_KINDS as readonly string[]).includes(value);
}

/** `null` = sin filtro de asunto; `undefined` = regla ilegible. */
function parseSubject(value: unknown): SubjectRule | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { mode, value: text } = value;
  if ((mode !== 'equals' && mode !== 'prefix') || typeof text !== 'string') return undefined;
  return { mode, value: text };
}

function parseExtraction(value: unknown): ExtractionRule | null {
  if (!isRecord(value)) return null;
  if (value['type'] === 'fixed_length_code') {
    const { leadingLiteral, codeLength, charset, trailingLiteral } = value;
    if (
      typeof leadingLiteral !== 'string' ||
      typeof codeLength !== 'number' ||
      (charset !== 'digits' && charset !== 'alphanumeric') ||
      typeof trailingLiteral !== 'string'
    ) {
      return null;
    }
    return { type: 'fixed_length_code', leadingLiteral, codeLength, charset, trailingLiteral };
  }
  if (value['type'] === 'allowed_host_link') {
    const { allowedHosts, pathPrefix } = value;
    if (
      !Array.isArray(allowedHosts) ||
      !allowedHosts.every((host): host is string => typeof host === 'string') ||
      typeof pathPrefix !== 'string'
    ) {
      return null;
    }
    return { type: 'allowed_host_link', allowedHosts, pathPrefix };
  }
  return null;
}
