import type { InboundReceipt } from '@iam/contracts';
import { Badge, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TablePaging } from '../../../shared/api';
import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

const NO_OP = () => undefined;

export type InboundHistoryTableProps = {
  receipts: InboundReceipt[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
  paging: TablePaging;
  /** Zona horaria del perfil para mostrar la fecha de recepción. */
  timeZone: string | undefined;
};

/**
 * Tabla estándar del historial de recepciones de una vista. No lleva valores de códigos: solo
 * cuándo llegó cada mensaje, el dominio que lo firmó y de qué tipo era.
 */
export function InboundHistoryTable({
  receipts,
  status,
  errorMessage,
  onRetry,
  refreshing,
  paging,
  timeZone,
}: InboundHistoryTableProps) {
  const { t, i18n } = useTranslation('inbound');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<InboundReceipt>[]>(
    () => [
      {
        id: 'receivedAt',
        header: t('history.col.receivedAt'),
        cell: (row) => (
          <span className="font-mono text-text-secondary">
            {formatDateTime(row.receivedAt, i18n.language, timeZone)}
          </span>
        ),
      },
      {
        id: 'kind',
        header: t('history.col.kind'),
        cell: (row) => <Badge dot>{t(`templateKind.${row.templateKind}`)}</Badge>,
      },
      {
        id: 'signingDomain',
        header: t('history.col.signingDomain'),
        // Un mensaje sin firma DKIM verificable no trae dominio: se dice con texto, no con una celda vacía.
        cell: (row) =>
          row.signingDomain === null ? (
            t('history.domain.unknown')
          ) : (
            <span className="font-mono text-text-secondary">{row.signingDomain}</span>
          ),
      },
    ],
    [i18n.language, t, timeZone],
  );

  return (
    <DataTable<InboundReceipt>
      caption={t('history.caption')}
      columns={columns}
      rows={receipts}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      refreshing={refreshing}
      labels={labels}
      emptyState={
        <EmptyState title={t('history.empty.title')} description={t('history.empty.description')} />
      }
      errorState={{ message: errorMessage, onRetry }}
    />
  );
}
