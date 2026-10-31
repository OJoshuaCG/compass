/**
 * Compuerta DKIM sobre un resultado estructurado (ADR 0045 sección 2, IC-1).
 *
 * Este módulo NO verifica criptografía: recibe lo que un verificador (puerto de la rebanada IC-3) ya
 * comprobó. Solo decide si esa firma basta para confiar en el remitente declarado. Es una función pura:
 * el reloj entra como parámetro y los datos hostiles producen un motivo de rechazo, nunca una excepción.
 *
 * Todo rechazo falla cerrado: un conteo no entero, una fecha inválida o una lista vacía se tratan como
 * incumplimiento. La alineación es ESTRICTA (`d=` igual al dominio del `From`); la relajada necesitaría
 * una lista de sufijos públicos (dependencia sin aprobar) y no se implementa.
 */
import { MILLISECONDS_PER_MINUTE } from './inbound-limits.js';
import { normalizeEmailAddress } from './mail-address.js';
import { isVisibleAsciiOnly, toAsciiLowercase } from './ascii-text.js';

/** Tamaño mínimo de clave (propuesta del ADR 0045; por medir con correos reales, algunas plataformas usan 1024). */
export const DKIM_MIN_KEY_BITS = 2048;

/** Cuánto puede adelantarse `t=` respecto al reloj propio antes de considerarse sospechoso. */
export const DKIM_FUTURE_TIMESTAMP_TOLERANCE_MINUTES = 5;
const DKIM_FUTURE_TIMESTAMP_TOLERANCE_MS =
  DKIM_FUTURE_TIMESTAMP_TOLERANCE_MINUTES * MILLISECONDS_PER_MINUTE;

export const DKIM_REJECTION_REASONS = [
  'NO_VALID_SIGNATURE',
  'MISSING_FROM',
  'DUPLICATE_FROM',
  'DUPLICATE_SUBJECT',
  'INVALID_FROM_ADDRESS',
  'RECIPIENT_MISMATCH',
  'BODY_LENGTH_LIMIT_PRESENT',
  'WEAK_KEY',
  'SIGNATURE_EXPIRED',
  'SIGNATURE_TIMESTAMP_INVALID',
  'FROM_NOT_OVERSIGNED',
  'SUBJECT_NOT_OVERSIGNED',
  'DATE_NOT_SIGNED',
  'TO_NOT_SIGNED',
  'DOMAIN_NOT_ALIGNED',
] as const;

export type DkimRejectionReason = (typeof DKIM_REJECTION_REASONS)[number];

/** Instancias de cada cabecera relevante (en el mensaje) o menciones en `h=` (en la firma). */
export interface HeaderCounts {
  readonly from: number;
  readonly to: number;
  readonly subject: number;
  readonly date: number;
}

/** Una firma que el verificador YA validó criptográficamente. */
export interface DkimSignatureEvidence {
  /** `d=`: dominio firmante. */
  readonly signingDomain: string;
  /** Cuántas veces aparece cada cabecera en `h=`. */
  readonly signedHeaderCounts: HeaderCounts;
  /** `true` si la firma trae `l=` (permite añadir contenido sin invalidarla). */
  readonly hasBodyLengthLimit: boolean;
  /** `t=`; `null` si no viene. */
  readonly signedAt: Date | null;
  /** `x=`; `null` si no viene. */
  readonly expiresAt: Date | null;
  /** Tamaño de la clave pública en bits. */
  readonly keyBits: number;
}

export interface DkimGateInput {
  /** Dirección de la fuente que recibió el mensaje. */
  readonly sourceAlias: string;
  readonly now: Date;
  /** Dirección ya extraída de la cabecera `From` (sin nombre visible); `null` si no hubo. */
  readonly fromAddress: string | null;
  /** Direcciones ya extraídas de la(s) cabecera(s) `To`. */
  readonly toAddresses: readonly string[];
  readonly headerInstanceCounts: HeaderCounts;
  /** Solo las firmas que validaron; una lista vacía significa que ninguna validó. */
  readonly validatedSignatures: readonly DkimSignatureEvidence[];
}

export type DkimGateResult =
  | {
      readonly accepted: true;
      /** `d=` de la firma que cumplió todo, normalizado. */
      readonly signingDomain: string;
      /** Dirección `From` normalizada: la única que las plantillas deben comparar. */
      readonly fromAddress: string;
    }
  | { readonly accepted: false; readonly reason: DkimRejectionReason };

const REJECT_NO_SIGNATURE: DkimGateResult = { accepted: false, reason: 'NO_VALID_SIGNATURE' };

function reject(reason: DkimRejectionReason): DkimGateResult {
  return { accepted: false, reason };
}

/** Un conteo no entero o negativo (dato hostil) nunca cumple. */
function isValidCount(count: number): boolean {
  return Number.isInteger(count) && count >= 0;
}

/**
 * La cabecera está firmada si `h=` la menciona al menos tantas veces como instancias hay (y al menos una).
 * Así no queda ninguna instancia sin firmar.
 */
function isSigned(signedCount: number, presentCount: number): boolean {
  const requiredCount = Math.max(presentCount, 1);
  return isValidCount(signedCount) && signedCount >= requiredCount;
}

/**
 * Sobrefirmada: `h=` la menciona una vez MÁS que las instancias presentes. Esa mención extra firma "no hay
 * otra instancia", y por eso añadir un segundo `From` o `Subject` tras la firma invalida la firma.
 * Se exige una mención adicional aunque el criterio del ADR hable de "conteo menor": con el conteo igual
 * al de instancias el atacante todavía puede anteponer una cabecera.
 */
function isOversigned(signedCount: number, presentCount: number): boolean {
  return isValidCount(signedCount) && signedCount >= presentCount + 1;
}

function isUsableDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function normalizeDomain(domain: string): string | null {
  if (domain.length === 0 || !isVisibleAsciiOnly(domain)) return null;
  return toAsciiLowercase(domain);
}

/** Reglas por mensaje que no dependen de ninguna firma en particular. */
function findMessageLevelRejection(
  input: DkimGateInput,
): { reason: DkimRejectionReason } | { fromAddress: string; fromDomain: string } {
  const counts = input.headerInstanceCounts;

  if (!isValidCount(counts.from) || counts.from === 0) return { reason: 'MISSING_FROM' };
  if (counts.from > 1) return { reason: 'DUPLICATE_FROM' };
  if (!isValidCount(counts.subject) || counts.subject > 1) return { reason: 'DUPLICATE_SUBJECT' };

  const fromAddress = input.fromAddress === null ? null : normalizeEmailAddress(input.fromAddress);
  if (fromAddress === null) return { reason: 'INVALID_FROM_ADDRESS' };

  // Un correo firmado para otro destinatario no se reutiliza: el `To` debe ser exactamente el alias.
  const alias = normalizeEmailAddress(input.sourceAlias);
  const onlyRecipient = input.toAddresses.length === 1 ? input.toAddresses[0] : undefined;
  const recipient = onlyRecipient === undefined ? null : normalizeEmailAddress(onlyRecipient);
  if (alias === null || recipient === null || recipient.address !== alias.address) {
    return { reason: 'RECIPIENT_MISMATCH' };
  }

  return { fromAddress: fromAddress.address, fromDomain: fromAddress.domain };
}

/** Primera regla que incumple esta firma, o `null` si cumple todas. */
function findSignatureRejection(
  signature: DkimSignatureEvidence,
  input: DkimGateInput,
  fromDomain: string,
): DkimRejectionReason | null {
  const counts = input.headerInstanceCounts;
  const signed = signature.signedHeaderCounts;
  const nowMs = input.now.getTime();

  if (signature.hasBodyLengthLimit) return 'BODY_LENGTH_LIMIT_PRESENT';
  if (!(signature.keyBits >= DKIM_MIN_KEY_BITS)) return 'WEAK_KEY';

  // `x=` inválido o igual al instante actual cuenta como vencido (falla cerrado).
  if (signature.expiresAt !== null) {
    const expiresAtMs = signature.expiresAt.getTime();
    if (!(expiresAtMs > nowMs)) return 'SIGNATURE_EXPIRED';
  }
  if (signature.signedAt !== null) {
    const hasUsableTimestamp = isUsableDate(signature.signedAt);
    if (
      !hasUsableTimestamp ||
      signature.signedAt.getTime() > nowMs + DKIM_FUTURE_TIMESTAMP_TOLERANCE_MS
    ) {
      return 'SIGNATURE_TIMESTAMP_INVALID';
    }
  }

  if (!isOversigned(signed.from, counts.from)) return 'FROM_NOT_OVERSIGNED';
  if (!isOversigned(signed.subject, counts.subject)) return 'SUBJECT_NOT_OVERSIGNED';
  if (!isSigned(signed.date, counts.date)) return 'DATE_NOT_SIGNED';
  if (!isSigned(signed.to, counts.to)) return 'TO_NOT_SIGNED';

  // Alineación ESTRICTA: `d=` exactamente igual al dominio del `From` (ni subdominios ni superdominios).
  const signingDomain = normalizeDomain(signature.signingDomain);
  if (signingDomain === null || signingDomain !== fromDomain) return 'DOMAIN_NOT_ALIGNED';

  return null;
}

/**
 * Decide si el mensaje pasa la compuerta. Acepta si ALGUNA firma validada cumple todas las reglas; si
 * ninguna cumple, devuelve el motivo de la primera. Sin una firma que cumpla, el filtro de plantillas no se
 * aplica: el remitente de un correo es falsificable.
 */
export function evaluateDkimGate(input: DkimGateInput): DkimGateResult {
  if (!isUsableDate(input.now)) return REJECT_NO_SIGNATURE;
  if (input.validatedSignatures.length === 0) return REJECT_NO_SIGNATURE;

  const messageLevel = findMessageLevelRejection(input);
  if ('reason' in messageLevel) return reject(messageLevel.reason);

  let firstRejection: DkimRejectionReason | null = null;
  for (const signature of input.validatedSignatures) {
    const rejection = findSignatureRejection(signature, input, messageLevel.fromDomain);
    if (rejection === null) {
      return {
        accepted: true,
        signingDomain: messageLevel.fromDomain,
        fromAddress: messageLevel.fromAddress,
      };
    }
    firstRejection ??= rejection;
  }
  return reject(firstRejection ?? 'NO_VALID_SIGNATURE');
}
