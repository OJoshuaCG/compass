import { DEFAULT_PAGE_LIMIT, type Share } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { formatDateTime } from '../../../shared/lib';

export type SharesTableProps = {
  shares: Share[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  /** Zona horaria del perfil, para las fechas. */
  timeZone: string | undefined;
  /** Decisión de comodidad (permiso + nivel) que toma el container; el servidor decide siempre. */
  canRevoke: boolean;
  onRevoke: (share: Share) => void;
};

const NO_OP = () => undefined;

/**
 * Tabla estándar de comparticiones. Presentacional: los grupos se muestran igual que las personas
 * (el tipo va como texto, no solo como color). El listado llega completo, sin cursor.
 */
export function SharesTable({
  shares,
  status,
  errorMessage,
  onRetry,
  timeZone,
  canRevoke,
  onRevoke,
}: SharesTableProps) {
  const { t, i18n } = useTranslation('shares');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<Share>[]>(
    () => [
      { id: 'grantee', header: t('col.grantee'), cell: (row) => row.granteeName },
      {
        id: 'type',
        header: t('col.type'),
        cell: (row) => <Badge>{t(`granteeType.${row.granteeType}`)}</Badge>,
      },
      { id: 'level', header: t('col.level'), cell: (row) => t(`level.${row.level}`) },
      {
        id: 'expiresAt',
        header: t('col.expiresAt'),
        cell: (row) =>
          row.expiresAt === null
            ? t('expires.never')
            : formatDateTime(row.expiresAt, i18n.language, timeZone),
      },
      {
        id: 'createdAt',
        header: t('col.createdAt'),
        cell: (row) => formatDateTime(row.createdAt, i18n.language, timeZone),
      },
    ],
    [i18n.language, t, timeZone],
  );

  return (
    <DataTable<Share>
      caption={t('caption')}
      columns={columns}
      rows={shares}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={NO_OP}
      limit={DEFAULT_PAGE_LIMIT}
      onLimitChange={NO_OP}
      pagination={{ hasPrevious: false, hasNext: false, onPrevious: NO_OP, onNext: NO_OP }}
      hidePagination
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={
        canRevoke
          ? (row) => (
              <span className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t('action.revokeLabel', { name: row.granteeName })}
                  onClick={() => {
                    onRevoke(row);
                  }}
                >
                  {t('action.revoke')}
                </Button>
              </span>
            )
          : undefined
      }
    />
  );
}
