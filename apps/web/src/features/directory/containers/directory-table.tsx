import { DataTable, EmptyState, SearchInput, type Column } from '@iam/ui';
import type { DirectoryUser } from '@iam/contracts';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTableQuery, type TableSearch } from '../../../shared/api';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { directoryKeys, fetchUsersPage } from '../api/directory-api';

export type DirectoryTableProps = {
  search: TableSearch;
  onSearchChange: (patch: Partial<TableSearch>) => void;
};

/** Directorio visible para cualquier persona: la `DataTable` estándar con su estado en la URL. */
export function DirectoryTable({ search, onSearchChange }: DirectoryTableProps) {
  const { t } = useTranslation(['directory', 'common']);
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();

  const table = useTableQuery<DirectoryUser>({
    queryKey: directoryKeys.users(),
    fetchPage: fetchUsersPage,
    search,
    onSearchChange,
  });
  // La búsqueda se escribe sin pedir en cada tecla: la URL se actualiza al dejar de teclear.
  const [draft, setDraft] = useDebouncedCommit(table.q, table.onQueryChange);

  const columns = useMemo<Column<DirectoryUser>[]>(
    () => [
      {
        id: 'displayName',
        header: t('users.col.name', { ns: 'directory' }),
        cell: (row) => row.displayName,
        sortKey: 'displayName',
      },
      {
        id: 'email',
        header: t('users.col.email', { ns: 'directory' }),
        cell: (row) => <span className="text-text-secondary">{row.email}</span>,
        sortKey: 'email',
      },
      {
        id: 'rank',
        header: t('users.col.rank', { ns: 'directory' }),
        cell: (row) => t(`rank.${String(row.rank)}`, { ns: 'common' }),
        sortKey: 'rank',
      },
    ],
    [t],
  );

  return (
    <DataTable<DirectoryUser>
      caption={t('users.caption', { ns: 'directory' })}
      columns={columns}
      rows={table.rows}
      getRowId={(row) => row.id}
      status={table.status}
      sort={table.sort}
      onSortChange={table.onSortChange}
      limit={table.limit}
      onLimitChange={table.onLimitChange}
      pagination={table.pagination}
      refreshing={table.refreshing}
      hasActiveFilters={table.hasActiveFilters}
      onClearFilters={table.clearFilters}
      labels={labels}
      emptyState={
        <EmptyState
          title={t('users.empty.title', { ns: 'directory' })}
          description={t('users.empty.description', { ns: 'directory' })}
        />
      }
      errorState={{ message: errorMessage(table.error), onRetry: table.retry }}
      toolbar={
        <SearchInput
          className="max-w-sm"
          label={t('search.label', { ns: 'common' })}
          clearLabel={t('search.clear', { ns: 'common' })}
          placeholder={t('search.placeholder', { ns: 'common' })}
          value={draft}
          onValueChange={setDraft}
        />
      }
    />
  );
}
