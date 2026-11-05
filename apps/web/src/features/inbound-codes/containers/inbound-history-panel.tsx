import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { createInboundHistoryFetcher, inboundKeys } from '../api/inbound-api';
import { InboundHistoryTable } from '../ui/inbound-history-table';

export type InboundHistoryPanelProps = {
  viewId: string;
};

/**
 * Historial de recepciones de la vista con paginación por cursor. No contiene secretos (solo
 * fecha, dominio y tipo), así que pasa por Query como cualquier otro listado.
 */
export function InboundHistoryPanel({ viewId }: InboundHistoryPanelProps) {
  const { t } = useTranslation('inbound');
  const headingId = useId();
  const errorMessage = useErrorMessage();
  const timeZone = useMe()?.user.timezone;
  const fetchPage = useMemo(() => createInboundHistoryFetcher(viewId), [viewId]);

  const table = useFixedOrderTable({ queryKey: inboundKeys.history(viewId), fetchPage });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg text-text">
        {t('history.heading')}
      </h2>
      <p className="text-sm text-text-secondary">{t('history.description')}</p>
      <InboundHistoryTable
        receipts={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        refreshing={table.refreshing}
        paging={table}
        timeZone={timeZone}
      />
    </section>
  );
}
