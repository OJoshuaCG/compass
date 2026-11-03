/**
 * Antigüedad del último cambio de contraseña, como semáforo **informativo**.
 *
 * Decisión del dueño (2026-11-02): no se notifica ni se obliga a cambiar la contraseña; solo se muestra
 * un indicador. Verde hasta 60 días, amarillo de más de 60 hasta 90 y rojo de más de 90. Los umbrales son
 * constantes y no configuración de la organización.
 */
import type { PasswordAgeStatus } from '@iam/contracts';

export const PASSWORD_AGING_AFTER_DAYS = 60;
export const PASSWORD_STALE_AFTER_DAYS = 90;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Instante antes del cual una fecha de cambio ya pasó `days` días: se usa tal cual en las consultas SQL. */
export function passwordAgeCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}

/**
 * `lastChangedAt` es la fecha de la credencial más antigua de la cuenta, o `null` si no tiene credenciales.
 * «Más de N días» es estricto: justo a los N días la cuenta sigue en el color anterior.
 */
export function classifyPasswordAge(lastChangedAt: Date | null, now: Date): PasswordAgeStatus {
  if (lastChangedAt === null) return 'none';
  if (lastChangedAt < passwordAgeCutoff(now, PASSWORD_STALE_AFTER_DAYS)) return 'stale';
  if (lastChangedAt < passwordAgeCutoff(now, PASSWORD_AGING_AFTER_DAYS)) return 'aging';
  return 'fresh';
}
