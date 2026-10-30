/**
 * Evaluación de un mensaje de correo entrante: de un resultado DKIM abstracto y un cuerpo ya extraído
 * a "aceptado" o "cuarentena con motivo enumerado" (ADR 0045, IC-1).
 *
 * Es una función pura, sin base de datos, red ni criptografía; el MIME ya viene parseado (IC-3). Orden:
 * deduplicación, topes de tamaño, compuerta DKIM, plantillas (clasificación fail-closed), tolerancia de
 * la fecha firmada y extracción. Ningún dato hostil produce una excepción: todo es un motivo de cuarentena.
 */
import { evaluateDkimGate } from './dkim-gate.js';
import type { DkimRejectionReason, DkimSignatureEvidence, HeaderCounts } from './dkim-gate.js';
import { classifyMatchedTemplates, classifyTemplate } from './inbound-classification.js';
import type { ItemVisibility } from './inbound-classification.js';
import { MAX_PROCESSED_BODY_LENGTH, MAX_SUBJECT_LENGTH } from './inbound-limits.js';
import { isTemplateEvaluable, templateMatchesEnvelope } from './inbound-template.js';
import type { InboundItemKind, InboundTemplate } from './inbound-template.js';
import { computeItemExpiry } from './item-validity.js';
import { decideDeduplication } from './message-fingerprint.js';
import { extractAllowedLink, extractFixedLengthCode } from './value-extraction.js';

export const QUARANTINE_REASONS = [
  'DUPLICATE_MESSAGE',
  'INVALID_FINGERPRINT',
  'SUBJECT_TOO_LONG',
  'BODY_TOO_LARGE',
  'MESSAGE_DATE_OUT_OF_TOLERANCE',
  'DATE_MISSING',
  'NO_MATCHING_TEMPLATE',
  'MATCHED_TEMPLATE_INVALID',
  'EXTRACTION_FAILED',
  'AMBIGUOUS_EXTRACTION',
] as const;

export type QuarantineReason = DkimRejectionReason | (typeof QUARANTINE_REASONS)[number];

export interface InboundMailMessage {
  /** Dirección de la fuente que recibió el mensaje. */
  readonly sourceAlias: string;
  readonly receivedAt: Date;
  /** Hash ya calculado del identificador del mensaje del proveedor. */
  readonly fingerprint: string;
  readonly fromAddress: string | null;
  readonly toAddresses: readonly string[];
  readonly headerInstanceCounts: HeaderCounts;
  readonly subject: string | null;
  /** Valor de la cabecera `Date`; la compuerta DKIM garantiza que está firmada si el mensaje se acepta. */
  readonly dateHeader: Date | null;
  readonly validatedSignatures: readonly DkimSignatureEvidence[];
  /** Texto plano ya extraído; el HTML nunca llega aquí. */
  readonly body: string;
}

export type ExtractedValue =
  | { readonly type: 'code'; readonly code: string }
  | { readonly type: 'link'; readonly url: string };

export type InboundEvaluation =
  | {
      readonly outcome: 'accepted';
      /** `login_code` solo si todas las plantillas coincidentes son explícitas; si no, un tipo sensible. */
      readonly kind: InboundItemKind;
      readonly visibility: ItemVisibility;
      readonly value: ExtractedValue;
      readonly expiresAt: Date;
      readonly signingDomain: string;
      /** Plantilla que produjo el valor. */
      readonly templateId: string;
    }
  | { readonly outcome: 'quarantined'; readonly reason: QuarantineReason };

function quarantine(reason: QuarantineReason): InboundEvaluation {
  return { outcome: 'quarantined', reason };
}

/** Las plantillas sensibles se prueban primero para que, ante dos valores posibles, nunca gane el visible. */
function orderSensitiveFirst(templates: readonly InboundTemplate[]): readonly InboundTemplate[] {
  const sensitiveTemplates = templates.filter(
    (template) => classifyTemplate(template) === 'sensitive',
  );
  const visibleTemplates = templates.filter(
    (template) => classifyTemplate(template) === 'visible_with_use',
  );
  return [...sensitiveTemplates, ...visibleTemplates];
}

function extractWithTemplate(
  template: InboundTemplate,
  body: string,
): ReturnType<typeof extractFixedLengthCode> {
  const rule = template.extraction;
  return rule.type === 'fixed_length_code'
    ? extractFixedLengthCode(body, rule)
    : extractAllowedLink(body, rule);
}

export function evaluateInboundMail(
  message: InboundMailMessage,
  templates: readonly InboundTemplate[],
  knownFingerprints: ReadonlySet<string>,
): InboundEvaluation {
  const deduplication = decideDeduplication(message.fingerprint, knownFingerprints);
  if (deduplication === 'duplicate') return quarantine('DUPLICATE_MESSAGE');
  if (deduplication === 'invalid_fingerprint') return quarantine('INVALID_FINGERPRINT');

  // Topes antes de cualquier procesamiento: nada hostil y enorme llega a la compuerta ni a las plantillas.
  if (message.subject !== null && message.subject.length > MAX_SUBJECT_LENGTH) {
    return quarantine('SUBJECT_TOO_LONG');
  }
  if (message.body.length > MAX_PROCESSED_BODY_LENGTH) return quarantine('BODY_TOO_LARGE');

  const gate = evaluateDkimGate({
    sourceAlias: message.sourceAlias,
    now: message.receivedAt,
    fromAddress: message.fromAddress,
    toAddresses: message.toAddresses,
    headerInstanceCounts: message.headerInstanceCounts,
    validatedSignatures: message.validatedSignatures,
  });
  if (!gate.accepted) return quarantine(gate.reason);

  // El remitente que comparan las plantillas es el `From` que la compuerta aprobó, nunca otro valor.
  const envelopeMatchedTemplates = templates.filter((template) =>
    templateMatchesEnvelope(template, gate.fromAddress, message.subject),
  );
  if (envelopeMatchedTemplates.length === 0) return quarantine('NO_MATCHING_TEMPLATE');

  // Una plantilla rota que coincide podía ser la sensible: ignorarla dejaría que otra hiciera visible
  // un restablecimiento. Ante la duda, el mensaje no se entrega.
  const matchedTemplates = envelopeMatchedTemplates.filter(isTemplateEvaluable);
  if (matchedTemplates.length !== envelopeMatchedTemplates.length) {
    return quarantine('MATCHED_TEMPLATE_INVALID');
  }

  // Sin `Date` no hay base firmada para limitar la repetición de un correo legítimo (amenaza T2):
  // la vigencia contada desde la recepción permitiría reenviarlo horas después como si fuera nuevo.
  if (message.dateHeader === null) return quarantine('DATE_MISSING');

  // La compuerta exige `Date` firmada, por lo que una fecha presente aquí es de confianza.
  const expiry = computeItemExpiry(message.receivedAt, message.dateHeader);
  if (!expiry.ok) return quarantine(expiry.reason);

  const visibility = classifyMatchedTemplates(matchedTemplates);
  for (const template of orderSensitiveFirst(matchedTemplates)) {
    const extraction = extractWithTemplate(template, message.body);
    if (!extraction.found) {
      if (extraction.reason === 'AMBIGUOUS') return quarantine('AMBIGUOUS_EXTRACTION');
      if (extraction.reason === 'BODY_TOO_LARGE') return quarantine('BODY_TOO_LARGE');
      continue;
    }

    const value: ExtractedValue =
      template.extraction.type === 'fixed_length_code'
        ? { type: 'code', code: extraction.value }
        : { type: 'link', url: extraction.value };
    return {
      outcome: 'accepted',
      kind: resolveEffectiveKind(visibility, value),
      visibility,
      value,
      expiresAt: expiry.expiresAt,
      signingDomain: gate.signingDomain,
      templateId: template.id,
    };
  }
  return quarantine('EXTRACTION_FAILED');
}

/** El tipo efectivo nunca es `login_code` salvo que la clasificación haya dejado el elemento visible. */
function resolveEffectiveKind(visibility: ItemVisibility, value: ExtractedValue): InboundItemKind {
  if (visibility === 'visible_with_use') return 'login_code';
  return value.type === 'link' ? 'reset_link' : 'reset_code';
}
