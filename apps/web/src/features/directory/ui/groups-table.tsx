import type { Group } from '@iam/contracts';
import { Badge, Button, DataTable, EmptyState, type Column } from '@iam/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataTableLabels } from '../../../shared/i18n';
import { useClientPagination } from '../../../shared/lib';

export type GroupsTableProps = {
  groups: Group[];
  status: 'loading' | 'success' | 'error';
  /** Mensaje ya traducido del error de carga. */
  errorMessage: string;
  onRetry: () => void;
  onOpenMembers: (group: Group) => void;
};

/**
 * Tabla estándar de grupos. Presentacional: el papel de quien consulta va como texto en una
 * etiqueta (nunca solo color). El listado llega completo, sin cursor: se pagina en memoria.
 */
export function GroupsTable({
  groups,
  status,
  errorMessage,
  onRetry,
  onOpenMembers,
}: GroupsTableProps) {
  const { t } = useTranslation('directory');
  const labels = useDataTableLabels();
  const paging = useClientPagination(groups);

  const columns = useMemo<Column<Group>[]>(
    () => [
      {
        id: 'name',
        header: t('groups.col.name'),
        cell: (row) => <span className="font-medium text-text">{row.name}</span>,
      },
      {
        id: 'description',
        header: t('groups.col.description'),
        cell: (row) =>
          row.description === null ? (
            <span className="text-text-secondary">{t('groups.noDescription')}</span>
          ) : (
            <span className="break-words text-text-secondary">{row.description}</span>
          ),
      },
      {
        id: 'members',
        header: t('groups.col.members'),
        align: 'end',
        cell: (row) => <span className="font-mono">{row.memberCount}</span>,
      },
      {
        id: 'myRole',
        header: t('groups.col.myRole'),
        cell: (row) =>
          row.myRole === null ? (
            <span className="text-text-secondary">{t('groups.role.none')}</span>
          ) : (
            <Badge dot tone={row.myRole === 'manager' ? 'accent' : 'neutral'}>
              {t(`groups.role.${row.myRole}`)}
            </Badge>
          ),
      },
    ],
    [t],
  );

  return (
    <DataTable<Group>
      caption={t('groups.caption')}
      columns={columns}
      rows={paging.pageRows}
      getRowId={(row) => row.id}
      status={status}
      onSortChange={() => undefined}
      limit={paging.limit}
      onLimitChange={paging.onLimitChange}
      pagination={paging.pagination}
      labels={labels}
      emptyState={
        <EmptyState title={t('groups.empty.title')} description={t('groups.empty.description')} />
      }
      errorState={{ message: errorMessage, onRetry }}
      rowActions={(row) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('groups.members.openLabel', { name: row.name })}
            onClick={() => {
              onOpenMembers(row);
            }}
          >
            {t('groups.members.open')}
          </Button>
        </span>
      )}
    />
  );
}
