import type { Role } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';

export type RolesTableProps = {
  roles: Role[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onView: (role: Role) => void;
  onArchive: (role: Role) => void;
  /** Hay una recarga en curso conservando las filas anteriores. */
  refreshing: boolean;
};

/**
 * Tabla estándar de roles. Presentacional: los de sistema solo se pueden consultar; archivar se
 * ofrece únicamente en los personalizados (el servidor lo rechaza igual en los de sistema).
 */
export function RolesTable({
  roles,
  status,
  errorMessage,
  onRetry,
  onView,
  onArchive,
  refreshing,
}: RolesTableProps) {
  const { t } = useTranslation('roles');
  const labels = useDataTableLabels();

  const columns = useMemo<Column<Role>[]>(
    () => [
      { id: 'name', header: t('col.name'), cell: (row) => row.name },
      {
        id: 'type',
        header: t('col.type'),
        cell: (row) =>
          row.isSystem ? (
            <Badge>{t('badge.system')}</Badge>
          ) : (
            <Badge tone="accent">{t('badge.custom')}</Badge>
          ),
      },
      {
        id: 'permissions',
        header: t('col.permissions'),
        cell: (row) => <span className="tabular-nums">{row.permissions.length}</span>,
      },
    ],
    [t],
  );

  return (
    <DataTable<Role>
      caption={t('caption')}
      columns={columns}
      rows={roles}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={100}
      onLimitChange={() => undefined}
      pagination={{
        hasPrevious: false,
        hasNext: false,
        onPrevious: () => undefined,
        onNext: () => undefined,
      }}
      hidePagination
      refreshing={refreshing}
      labels={labels}
      emptyState={<EmptyState title={t('empty.title')} description={t('empty.description')} />}
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('action.viewLabel', { name: row.name })}
            onClick={() => {
              onView(row);
            }}
          >
            {t('action.view')}
          </Button>
          {row.isSystem ? null : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('action.archiveLabel', { name: row.name })}
              onClick={() => {
                onArchive(row);
              }}
            >
              {t('action.archive')}
            </Button>
          )}
        </span>
      )}
    />
  );
}
