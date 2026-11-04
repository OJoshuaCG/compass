import { Card, CardBody, Skeleton } from '@iam/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorAlert } from '../../../shared/i18n';
import type { SummaryCount } from '../model/summary-count';

export type SummaryCardProps = {
  /** Ya traducido. */
  title: string;
  status: 'loading' | 'error' | 'ready';
  error?: unknown;
  onRetry: () => void;
  count?: SummaryCount | undefined;
  /** Texto cuando la cifra exacta es cero (estado vacío), ya traducido. */
  emptyText: string;
};

/**
 * Tarjeta de una cifra del inicio con sus cuatro estados: cargando, error, vacío y dato. Nunca
 * pinta una cifra que no sea exacta: cuando no lo es, lo dice en lugar de aproximar.
 */
export function SummaryCard({ title, status, error, onRetry, count, emptyText }: SummaryCardProps) {
  const { t, i18n } = useTranslation('common');
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId}>
      <CardBody className="flex flex-col gap-2">
        <h3 id={titleId} className="text-sm font-medium text-text-secondary">
          {title}
        </h3>
        {status === 'loading' ? (
          <div aria-busy="true">
            <Skeleton className="h-9 w-20" />
            <span role="status" className="sr-only">
              {t('state.loading')}
            </span>
          </div>
        ) : null}
        {status === 'error' ? <ErrorAlert error={error} onRetry={onRetry} /> : null}
        {status === 'ready' && count?.kind === 'exact' ? (
          <>
            <p className="font-heading text-3xl font-semibold text-text">
              {new Intl.NumberFormat(i18n.language).format(count.value)}
            </p>
            {count.value === 0 ? <p className="text-sm text-text-secondary">{emptyText}</p> : null}
          </>
        ) : null}
        {status === 'ready' && count?.kind === 'unavailable' ? (
          <>
            <p className="font-heading text-lg text-text">{t('home.stat.unavailable')}</p>
            <p className="text-sm text-text-secondary">{t('home.stat.unavailableHint')}</p>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}
