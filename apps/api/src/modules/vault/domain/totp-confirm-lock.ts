/**
 * Política del bloqueo escalonado al confirmar un registro pendiente del segundo factor (T5b).
 *
 * Tras `TOTP_CONFIRM_MAX_FAILURES` fallos consecutivos el registro se bloquea por tiempo; cada bloqueo
 * sucesivo dura más (`TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL`, el último valor se repite). El nivel de
 * escalamiento sobrevive a la expiración del bloqueo y solo se reinicia al confirmar con éxito o al
 * registrar de nuevo (llave nueva). Son funciones puras: el reloj entra como parámetro.
 */
import { TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL, TOTP_CONFIRM_MAX_FAILURES } from '@iam/contracts';

const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Estado de un registro pendiente: nada se conserva de los códigos, solo cuentas y una fecha. */
export interface TotpConfirmLockState {
  /** Fallos consecutivos desde el último bloqueo. Vuelve a cero cuando se impone un bloqueo. */
  readonly failures: number;
  /** Cuántos bloqueos se han impuesto a este registro; decide la duración del siguiente. */
  readonly lockCount: number;
  /** Fin del bloqueo vigente (o ya vencido); `null` si nunca se bloqueó. */
  readonly lockedUntil: Date | null;
}

export const INITIAL_TOTP_CONFIRM_LOCK_STATE: TotpConfirmLockState = {
  failures: 0,
  lockCount: 0,
  lockedUntil: null,
};

/** Duración del bloqueo número `lockCount` (1 = primero). Pasado el último escalón, se repite el último. */
export function lockDurationMs(lockCount: number): number {
  const lastLevelIndex = TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL.length - 1;
  const levelIndex = Math.min(Math.max(lockCount - 1, 0), lastLevelIndex);
  const minutes = TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL[levelIndex];
  if (minutes === undefined)
    throw new Error('The lock duration list for TOTP confirmation is empty');
  return minutes * MILLISECONDS_PER_MINUTE;
}

/** `true` mientras el bloqueo siga vigente. En el instante exacto de `lockedUntil` ya no lo está. */
export function isLocked(state: TotpConfirmLockState, now: Date): boolean {
  return state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime();
}

/**
 * Estado tras un fallo. Al llegar al máximo se impone el siguiente bloqueo y el contador de fallos vuelve a
 * cero: al expirar, hay que fallar otras diez veces para el escalón siguiente.
 */
export function afterFailure(state: TotpConfirmLockState, now: Date): TotpConfirmLockState {
  const failures = state.failures + 1;
  if (failures < TOTP_CONFIRM_MAX_FAILURES) return { ...state, failures };
  const lockCount = state.lockCount + 1;
  return {
    failures: 0,
    lockCount,
    lockedUntil: new Date(now.getTime() + lockDurationMs(lockCount)),
  };
}
