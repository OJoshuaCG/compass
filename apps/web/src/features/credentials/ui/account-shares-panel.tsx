import type { Share } from '@iam/contracts';
import { Badge, Panel, Spinner } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '../../../shared/lib';

export type AccountSharesPanelProps = {
  accountId: string;
  shares: Share[] | undefined;
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  timeZone: string | undefined;
};

/** Iniciales para el avatar: primera letra de las dos primeras palabras del nombre. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

/**
 * "Compartida con" del detalle de cuenta (diseño de Compass): resumen de solo lectura de las
 * comparticiones vigentes. Agregar o revocar se hace en la pantalla de comparticiones.
 */
export function AccountSharesPanel({
  accountId,
  shares,
  status,
  errorMessage,
  timeZone,
}: AccountSharesPanelProps) {
  const { t, i18n } = useTranslation(['credentials', 'common']);
  return (
    <Panel
      title={t('shares.title', { ns: 'credentials' })}
      aside={
        <Link
          to="/accounts/$accountId/shares"
          params={{ accountId }}
          className="text-sm text-accent underline underline-offset-4"
        >
          {t('shares.manage', { ns: 'credentials' })}
        </Link>
      }
    >
      {status === 'loading' ? (
        <Spinner label={t('state.loading', { ns: 'common' })} />
      ) : status === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      ) : shares === undefined || shares.length === 0 ? (
        <p className="text-sm text-text-secondary">{t('shares.empty', { ns: 'credentials' })}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-bold text-accent"
              >
                {initials(share.granteeName)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-text">
                  {share.granteeName}
                </span>
                <span className="text-xs text-text-muted">
                  {t(`shares.granteeType.${share.granteeType}`, { ns: 'credentials' })}
                  {' · '}
                  {share.expiresAt === null
                    ? t('shares.permanent', { ns: 'credentials' })
                    : t('shares.expires', {
                        ns: 'credentials',
                        date: formatDateTime(share.expiresAt, i18n.language, timeZone),
                      })}
                </span>
              </span>
              <Badge tone="accent">{t(`level.${share.level}`, { ns: 'credentials' })}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
