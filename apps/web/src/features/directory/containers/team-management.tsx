import type { ManagedUser, Permission, Rank, UserStatus } from '@iam/contracts';
import {
  DataTable,
  EmptyState,
  RowActionsMenu,
  SearchInput,
  StatusBadge,
  type Column,
  type RowActionItem,
  type Status,
} from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useTableQuery, type TableSearch } from '../../../shared/api';
import { ErrorAlert, useDataTableLabels, useErrorMessage } from '../../../shared/i18n';
import { useDebouncedCommit } from '../../../shared/lib';
import { useToast } from '../../../shared/toast';
import { directoryKeys } from '../api/directory-api';
import { fetchManagedPage, teamApi } from '../api/team-api';
import { availableActions, type TeamAction } from '../model/team-actions';

import { ChangeRankDialog } from './change-rank-dialog';
import { DeactivateDialog } from './deactivate-dialog';
import { TransferManagerDialog } from './transfer-manager-dialog';

export type TeamManagementProps = {
  search: TableSearch;
  onSearchChange: (patch: Partial<TableSearch>) => void;
  /** Quien gestiona: su rango y permisos deciden qué acciones se ofrecen (solo comodidad). */
  actor: { rank: Rank; permissions: readonly Permission[] };
};

/** Estado → insignia: siempre ícono + texto, nunca solo color (docs/frontend.md §5.3). */
const STATUS_TONE: Record<UserStatus, Status> = {
  invited: 'info',
  active: 'success',
  suspended: 'warning',
  deactivated: 'neutral',
};

type DialogState = { kind: 'deactivate' | 'changeRank' | 'transfer'; person: ManagedUser };

/**
 * Pestaña "Gestión del equipo": la `DataTable` estándar sobre `GET /users/managed` con un menú de
 * acciones por fila. Suspender y reactivar son inmediatas; dar de baja, cambiar el rango y
 * transferir abren un diálogo. Tras cada acción: aviso de éxito y recarga de la tabla.
 */
export function TeamManagement({ search, onSearchChange, actor }: TeamManagementProps) {
  const { t } = useTranslation(['directory', 'common']);
  const labels = useDataTableLabels();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const direct = useAsyncAction((kind: 'suspend' | 'reactivate', person: ManagedUser) =>
    kind === 'suspend' ? teamApi.suspend(person.id) : teamApi.reactivate(person.id),
  );

  const table = useTableQuery<ManagedUser>({
    queryKey: directoryKeys.managed(),
    fetchPage: fetchManagedPage,
    search,
    onSearchChange,
  });
  const [draft, setDraft] = useDebouncedCommit(table.q, table.onQueryChange);

  /** Éxito de cualquier acción: aviso, cierre del diálogo y recarga (también del directorio). */
  function done(message: string) {
    toast.show(message, 'success');
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: directoryKeys.all });
  }

  async function runDirect(kind: 'suspend' | 'reactivate', person: ManagedUser) {
    const result = await direct.run(kind, person);
    if (result.ok) {
      done(
        t(kind === 'suspend' ? 'team.toast.suspended' : 'team.toast.reactivated', {
          ns: 'directory',
          name: person.displayName,
        }),
      );
    }
  }

  function itemFor(action: TeamAction, person: ManagedUser): RowActionItem {
    const label = t(`team.action.${action}`, { ns: 'directory' });
    switch (action) {
      case 'suspend':
      case 'reactivate':
        return {
          id: action,
          label,
          onSelect: () => {
            void runDirect(action, person);
          },
        };
      case 'deactivate':
        return {
          id: action,
          label,
          tone: 'danger',
          onSelect: () => {
            direct.reset();
            setDialog({ kind: 'deactivate', person });
          },
        };
      case 'changeRank':
      case 'transfer':
        return {
          id: action,
          label,
          onSelect: () => {
            direct.reset();
            setDialog({ kind: action, person });
          },
        };
    }
  }

  const columns = useMemo<Column<ManagedUser>[]>(
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
      {
        id: 'status',
        header: t('team.col.status', { ns: 'directory' }),
        cell: (row) => (
          <StatusBadge
            status={STATUS_TONE[row.status]}
            label={t(`team.status.${row.status}`, { ns: 'directory' })}
          />
        ),
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      {direct.error !== undefined ? <ErrorAlert error={direct.error} /> : null}
      <DataTable<ManagedUser>
        caption={t('team.caption', { ns: 'directory' })}
        columns={columns}
        rows={table.rows}
        getRowId={(row) => row.id}
        status={table.status}
        sort={table.sort}
        onSortChange={table.onSortChange}
        limit={table.limit}
        onLimitChange={table.onLimitChange}
        pagination={table.pagination}
        refreshing={table.refreshing || direct.pending}
        hasActiveFilters={table.hasActiveFilters}
        onClearFilters={table.clearFilters}
        labels={labels}
        emptyState={
          <EmptyState
            title={t('team.empty.title', { ns: 'directory' })}
            description={t('team.empty.description', { ns: 'directory' })}
          />
        }
        errorState={{ message: errorMessage(table.error), onRetry: table.retry }}
        rowActions={(row) => (
          <RowActionsMenu
            label={t('team.rowMenu', { ns: 'directory', name: row.displayName })}
            items={availableActions(row, actor).map((action) => itemFor(action, row))}
          />
        )}
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
      {dialog?.kind === 'deactivate' ? (
        <DeactivateDialog
          person={dialog.person}
          onClose={() => {
            setDialog(null);
          }}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'changeRank' ? (
        <ChangeRankDialog
          person={dialog.person}
          actorRank={actor.rank}
          onClose={() => {
            setDialog(null);
          }}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'transfer' ? (
        <TransferManagerDialog
          person={dialog.person}
          onClose={() => {
            setDialog(null);
          }}
          onDone={done}
        />
      ) : null}
    </div>
  );
}
