import {
  ACCOUNT_LIST_FILTERS,
  type Account,
  type AccountListFilter,
  type Platform,
  type SavedAccountView,
} from '@iam/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe, usePermission } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useToast } from '../../../shared/toast';
import { accountsKeys, fetchAccountsPage, fetchSavedViews } from '../api/accounts-api';
import { canArchiveAccount, canEditAccount } from '../model/account-access';
import { AccountsTable } from '../ui/accounts-table';
import { AccountsToolbar } from '../ui/accounts-toolbar';
import { SavedViewsBar } from '../ui/saved-views-bar';

import { DeleteSavedViewDialog } from './delete-saved-view-dialog';
import { SaveViewDialog } from './save-view-dialog';
import { useAccountListTable } from './use-account-list-table';
import { useAccountTags } from './use-account-tags';

export type MyAccountsPanelProps = {
  platforms: readonly Platform[];
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
};

const toAccountListFilter = (value: string | undefined): AccountListFilter | undefined =>
  ACCOUNT_LIST_FILTERS.find((candidate) => candidate === value);

type ViewDialogState = { kind: 'save' } | { kind: 'delete'; view: SavedAccountView } | null;

/** Listado "Mis cuentas": las cuentas con acceso efectivo y las acciones que permiten permiso y nivel. */
export function MyAccountsPanel({ platforms, onEdit, onArchive }: MyAccountsPanelProps) {
  const errorMessage = useErrorMessage();
  // Solo comodidad: se ocultan las acciones sin permiso o nivel, pero el servidor decide siempre.
  const hasUpdatePermission = usePermission('account.update');
  const hasArchivePermission = usePermission('account.archive');

  const timeZone = useMe()?.user.timezone;

  const { t } = useTranslation('accounts');
  const queryClient = useQueryClient();
  const toast = useToast();

  const table = useAccountListTable({
    queryKey: accountsKeys.mine(),
    fetchPage: fetchAccountsPage,
  });
  const tagsQuery = useAccountTags();

  const savedViewsQuery = useQuery({
    queryKey: accountsKeys.savedViews(),
    queryFn: ({ signal }) => fetchSavedViews(signal),
  });
  const savedViews = savedViewsQuery.data ?? [];
  const [viewDialog, setViewDialog] = useState<ViewDialogState>(null);
  // Vista elegida o recién guardada; solo cuenta como activa mientras sus criterios sigan aplicados.
  const [chosenViewId, setChosenViewId] = useState<string | undefined>(undefined);

  const appliedText = table.q.trim() === '' ? undefined : table.q.trim();
  const appliedFilter = toAccountListFilter(table.filter);
  const matchesApplied = (view: SavedAccountView) =>
    (view.q ?? undefined) === appliedText && (view.filter ?? undefined) === appliedFilter;
  const chosenView = savedViews.find((view) => view.id === chosenViewId);
  const activeView =
    chosenView !== undefined && matchesApplied(chosenView)
      ? chosenView
      : savedViews.find(matchesApplied);

  const reloadViews = () => {
    void queryClient.invalidateQueries({ queryKey: accountsKeys.savedViews() });
  };

  return (
    <>
      <AccountsTable
        accounts={table.rows}
        platforms={platforms}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        canEdit={(account) => canEditAccount(hasUpdatePermission, account.myLevel)}
        canArchive={(account) => canArchiveAccount(hasArchivePermission, account.myLevel)}
        onEdit={onEdit}
        onArchive={onArchive}
        refreshing={table.refreshing}
        paging={table}
        hasActiveFilters={table.hasActiveFilters}
        onClearFilters={table.clearFilters}
        timeZone={timeZone}
        toolbar={
          <AccountsToolbar
            searchDraft={table.draft}
            onSearchChange={table.setDraft}
            filter={toAccountListFilter(table.filter)}
            onFilterChange={table.onFilterChange}
            tags={tagsQuery.data ?? []}
            tag={table.tag}
            onTagChange={table.onTagChange}
          >
            <SavedViewsBar
              views={savedViews}
              activeViewId={activeView?.id}
              onSelect={(view) => {
                setChosenViewId(view?.id);
                table.applyCriteria({ q: view?.q ?? undefined, filter: view?.filter ?? undefined });
              }}
              canSave={appliedText !== undefined || appliedFilter !== undefined}
              onSave={() => {
                setViewDialog({ kind: 'save' });
              }}
              onDelete={(view) => {
                setViewDialog({ kind: 'delete', view });
              }}
            />
          </AccountsToolbar>
        }
      />
      {viewDialog?.kind === 'save' ? (
        <SaveViewDialog
          criteria={{ q: appliedText, filter: appliedFilter }}
          onClose={() => {
            setViewDialog(null);
          }}
          onSaved={(view) => {
            setViewDialog(null);
            setChosenViewId(view.id);
            toast.show(t('views.saveToast', { name: view.name }), 'success');
            reloadViews();
          }}
        />
      ) : null}
      {viewDialog?.kind === 'delete' ? (
        <DeleteSavedViewDialog
          view={viewDialog.view}
          onClose={() => {
            setViewDialog(null);
          }}
          onDone={() => {
            const deletedName = viewDialog.view.name;
            setViewDialog(null);
            setChosenViewId(undefined);
            toast.show(t('views.deleteToast', { name: deletedName }), 'success');
            reloadViews();
          }}
        />
      ) : null}
    </>
  );
}
