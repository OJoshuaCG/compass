import type { InboundReceipt } from '@iam/contracts';
import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { createInboundHistoryFetcher, inboundKeys } from '../api/inbound-api';
import { formatDateTime } from '../../../shared/lib';
import { InboundHistoryTable } from '../ui/inbound-history-table';

import { InboundMailDeleteCell } from './inbound-mail-delete-cell';
import { InboundMailPreviewCell } from './inbound-mail-preview-cell';

export type InboundHistoryPanelProps = {
  viewId: string;
  /** Ofrece «Borrar correo del buzón» por fila. Solo comodidad: el servidor decide. */
  canDeleteMail?: boolean;
  /** Ofrece «Ver correo» (asunto) por fila. Solo comodidad: el servidor decide. */
  canPreviewMail?: boolean;
  /** Ofrece además el cuerpo completo dentro de «Ver correo» (permiso `inbound.reveal_reset`). */
  canPreviewMailBody?: boolean;
};

/**
 * Historial de recepciones de la vista con paginación por cursor. No contiene secretos (solo
 * fecha, dominio y tipo), así que pasa por Query como cualquier otro listado.
 */
export function InboundHistoryPanel({
  viewId,
  canDeleteMail = false,
  canPreviewMail = false,
  canPreviewMailBody = false,
}: InboundHistoryPanelProps) {
  const { t, i18n } = useTranslation('inbound');
  const headingId = useId();
  const errorMessage = useErrorMessage();
  const timeZone = useMe()?.user.timezone;
  const fetchPage = useMemo(() => createInboundHistoryFetcher(viewId), [viewId]);

  const table = useFixedOrderTable({ queryKey: inboundKeys.history(viewId), fetchPage });

  const renderRowActions = useCallback(
    (receipt: InboundReceipt) => {
      const receivedAtLabel = formatDateTime(receipt.receivedAt, i18n.language, timeZone);
      return (
        <div className="flex items-start justify-end gap-2">
          {canPreviewMail ? (
            <InboundMailPreviewCell
              receiptId={receipt.id}
              receivedAtLabel={receivedAtLabel}
              canViewBody={canPreviewMailBody}
            />
          ) : null}
          {canDeleteMail ? (
            <InboundMailDeleteCell receiptId={receipt.id} receivedAtLabel={receivedAtLabel} />
          ) : null}
        </div>
      );
    },
    [canDeleteMail, canPreviewMail, canPreviewMailBody, i18n.language, timeZone],
  );

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
        renderRowActions={canDeleteMail || canPreviewMail ? renderRowActions : undefined}
      />
    </section>
  );
}
