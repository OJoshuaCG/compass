/**
 * Salud de una credencial: señales de riesgo **informativas** calculadas a partir de hechos ya guardados.
 *
 * Nunca recibe ni devuelve el secreto: la fortaleza llega como puntaje (0 a 4, zxcvbn), la reutilización
 * como un conteo de credenciales con la misma huella HMAC y el resto como fechas y estados.
 * Decisión del dueño: solo alertas, nunca se bloquea una acción por estas señales.
 */
import { PASSWORD_STALE_AFTER_DAYS, passwordAgeCutoff } from './password-age.js';

/** Puntaje zxcvbn máximo que se considera débil (0 a 2 débil, 3 y 4 aceptable). */
export const WEAK_PASSWORD_MAX_SCORE = 2;

export type CredentialHealthSignal =
  | 'weak_password'
  | 'reused_password'
  | 'stale_password'
  | 'totp_missing'
  | 'totp_pending'
  | 'totp_exposed'
  | 'rotation_pending';

/** Estado del segundo factor tal como lo guarda `credential_totp`; `null` = la credencial no tiene fila. */
export type CredentialTotpState = 'pending' | 'verified' | 'retired';

/** Hechos de una credencial. Ninguno contiene el secreto. */
export interface CredentialHealthFacts {
  readonly credentialId: string;
  /** Puntaje de fortaleza; `null` si la contraseña se guardó antes de existir el puntaje (desconocido). */
  readonly strengthScore: number | null;
  /** Otras credenciales no archivadas de la organización con la misma huella de contraseña. */
  readonly reusedByOtherCredentials: number;
  /** Último cambio de contraseña; si nunca se rotó, la fecha de creación. */
  readonly lastChangedAt: Date;
  /** Si la plataforma de la cuenta admite segundo factor; sin soporte no se acusa su falta. */
  readonly platformSupportsTotp: boolean;
  readonly totpState: CredentialTotpState | null;
  /** El secreto del segundo factor se exportó (QR o clave mostrados). */
  readonly totpExposed: boolean;
  /** Hay una tarea de rotación pendiente o en curso para la credencial. */
  readonly hasOpenRotationTask: boolean;
}

export interface CredentialHealth {
  readonly credentialId: string;
  readonly signals: readonly CredentialHealthSignal[];
  /** `null` cuando la fortaleza no se conoce todavía. */
  readonly strengthScore: number | null;
}

export function evaluateCredentialHealth(
  facts: CredentialHealthFacts,
  now: Date,
): CredentialHealth {
  const signals: CredentialHealthSignal[] = [];

  if (facts.strengthScore !== null && facts.strengthScore <= WEAK_PASSWORD_MAX_SCORE) {
    signals.push('weak_password');
  }
  if (facts.reusedByOtherCredentials > 0) {
    signals.push('reused_password');
  }
  if (facts.lastChangedAt < passwordAgeCutoff(now, PASSWORD_STALE_AFTER_DAYS)) {
    signals.push('stale_password');
  }
  if (facts.platformSupportsTotp) {
    if (facts.totpState === null || facts.totpState === 'retired') signals.push('totp_missing');
    if (facts.totpState === 'pending') signals.push('totp_pending');
  }
  if (facts.totpExposed) {
    signals.push('totp_exposed');
  }
  if (facts.hasOpenRotationTask) {
    signals.push('rotation_pending');
  }

  return {
    credentialId: facts.credentialId,
    signals,
    strengthScore: facts.strengthScore,
  };
}

/** Conteos de salud de un conjunto de credenciales. Sin identificadores: solo números. */
export interface CredentialHealthSummary {
  readonly credentials: number;
  readonly withSignals: number;
  readonly strengthUnknown: number;
  readonly bySignal: Readonly<Record<CredentialHealthSignal, number>>;
}

const ALL_SIGNALS: readonly CredentialHealthSignal[] = [
  'weak_password',
  'reused_password',
  'stale_password',
  'totp_missing',
  'totp_pending',
  'totp_exposed',
  'rotation_pending',
];

export function summarizeCredentialHealth(
  entries: readonly CredentialHealth[],
): CredentialHealthSummary {
  const bySignal = Object.fromEntries(ALL_SIGNALS.map((signal) => [signal, 0])) as Record<
    CredentialHealthSignal,
    number
  >;
  let withSignals = 0;
  let strengthUnknown = 0;

  for (const entry of entries) {
    if (entry.signals.length > 0) withSignals += 1;
    if (entry.strengthScore === null) strengthUnknown += 1;
    for (const signal of entry.signals) bySignal[signal] += 1;
  }

  return { credentials: entries.length, withSignals, strengthUnknown, bySignal };
}
