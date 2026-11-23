import type { InboundViewSummary } from '@iam/contracts';
import { Badge, DataTable, EmptyState, type Column } from '@iam/ui';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import type { ClientPagination } from '../../../shared/lib';

const NO_OP = () => undefined;

export type InboundViewsTableProps = {
  views: InboundViewSummary[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** El servidor entrega el listado completo (tope de 200): se pagina en memoria. */
  paging: Pick<ClientPagination<InboundViewSummary>, 'limit' | 'onLimitChange' | 'pagination'>;
};

/**
 * Tabla estándar de las vistas legibles. Presentacional: el nombre de cada fila es el enlace a la
 * pantalla de la vista. Canal y nivel se escriben con texto, nunca solo con color.
 */
export function InboundViewsTable({
  views,
  status,
  errorMessage,
  onRetry,
  paging,
}: InboundViewsTableProps) {
  const { t } = useTranslation('inbound');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<InboundViewSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('col.name'),
        cell: (row) => (
          <Link
            to="/inbound/views/$viewId"
            params={{ viewId: row.id }}
            className="inline-flex min-h-6 items-center text-accent underline underline-offset-4"
          >
            {row.name}
          </Link>
        ),
      },
      { id: 'source', header: t('col.source'), cell: (row) => row.sourceDisplayName },
      { id: 'channel', header: t('col.channel'), cell: (row) => t(`channel.${row.channel}`) },
      {
        id: 'level',
        header: t('col.level'),
        cell: (row) => <Badge>{t(`level.${row.level}`)}</Badge>,
      },
    ],
    [t],
  );

  return (
    <DataTable<InboundViewSummary>
      caption={t('caption')}
      columns={columns}
      rows={views}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
    />
  );
}
