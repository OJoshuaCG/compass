import type { PasswordAgeStatus } from '@iam/contracts';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;
// Hasta aquí se cuenta en días; después, en meses, que se lee mejor ("hace 3 meses").
const MAX_DAYS_SHOWN_AS_DAYS = 60;

/** Color del círculo por estado; el texto siempre acompaña, el color nunca es el único canal. */
const DOT_CLASS_BY_STATUS: Record<PasswordAgeStatus, string> = {
  fresh: 'bg-success',
  aging: 'bg-warning',
  stale: 'bg-danger',
  none: 'bg-border-strong',
  unknown: 'bg-border-strong',
};

export type PasswordAgeIndicatorProps = {
  age: PasswordAgeStatus;
  /** Último cambio de la credencial más antigua; `null` sin credenciales. */
  lastChangedAt: string | null;
  /** Zona horaria del perfil para el detalle exacto. */
  timeZone?: string | undefined;
  /** Instante de referencia; se inyecta para que las pruebas no dependan del reloj. */
  now?: Date;
};

/**
 * Semáforo informativo de la antigüedad de la contraseña: un círculo de color, la etiqueta del estado y
 * cuánto hace del último cambio. Nunca obliga ni avisa a nadie: solo ayuda a decidir qué revisar.
 */
export function PasswordAgeIndicator({
  age,
  lastChangedAt,
  timeZone,
  now = new Date(),
}: PasswordAgeIndicatorProps) {
  const { t, i18n } = useTranslation('accounts');

  const hasDate = lastChangedAt !== null && age !== 'none' && age !== 'unknown';
  const exactDate = hasDate ? formatDateTime(lastChangedAt, i18n.language, timeZone) : undefined;
  const relativeDate = hasDate ? formatRelativeAge(lastChangedAt, now, i18n.language) : undefined;

  return (
    <span className="inline-flex items-center gap-2" title={exactDate}>
      <span
        aria-hidden="true"
        className={`inline-block size-2.5 shrink-0 rounded-full ${DOT_CLASS_BY_STATUS[age]}`}
      />
      <span>{t(`passwordAge.${age}`)}</span>
      {relativeDate !== undefined ? (
        <span className="text-text-secondary">{relativeDate}</span>
      ) : null}
    </span>
  );
}

function formatRelativeAge(lastChangedAt: string, now: Date, locale: string): string {
  const elapsedDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(lastChangedAt).getTime()) / MILLISECONDS_PER_DAY),
  );
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsedDays <= MAX_DAYS_SHOWN_AS_DAYS) {
    return formatter.format(-elapsedDays, 'day');
  }
  return formatter.format(-Math.floor(elapsedDays / DAYS_PER_MONTH), 'month');
}
