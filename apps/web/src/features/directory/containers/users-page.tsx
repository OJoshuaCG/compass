import {
  PageHeader,
  SearchInput,
  Button,
  DataTable,
  EmptyState,
  UserPlus,
  type Column,
} from '@iam/ui';
import type { DirectoryUser } from '@iam/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTableQuery, type TableSearch } from '../../../shared/api';
import { useMe, usePermission } from '../../../shared/auth';
import { useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { directoryKeys, fetchUsersPage } from '../api/directory-api';

import { InviteUserDialog } from './invite-user-dialog';

export type UsersPageProps = {
  /** Estado de la tabla que vive en la URL (validado por la ruta). */
  search: TableSearch;
  onSearchChange: (patch: Partial<TableSearch>) => void;
};

/** Container de `/users`: el directorio con la `DataTable` estándar y la acción de invitar. */
export function UsersPage({ search, onSearchChange }: UsersPageProps) {
  const { t } = useTranslation(['directory', 'common']);
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();
  const me = useMe();
  // Solo comodidad: el botón se oculta sin el permiso, pero el backend decide siempre.
  const canInvite = usePermission('user.invite');
  const [inviteOpen, setInviteOpen] = useState(false);

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
    <>
      <PageHeader
        title={t('users.title', { ns: 'directory' })}
        description={t('users.description', { ns: 'directory' })}
        actions={
          canInvite ? (
            <Button
              onClick={() => {
                setInviteOpen(true);
              }}
            >
              <UserPlus aria-hidden="true" className="size-4" />
              {t('users.invite', { ns: 'directory' })}
            </Button>
          ) : undefined
        }
      />
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
      {canInvite && me !== undefined ? (
        <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} actorRank={me.user.rank} />
      ) : null}
    </>
  );
}
