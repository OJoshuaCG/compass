import type { Account, AccountListFilter, Platform } from '@iam/contracts';

import { useMe, usePermission } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { accountsKeys, fetchAccountsPage } from '../api/accounts-api';
import { canArchiveAccount, canEditAccount } from '../model/account-access';
import { AccountsTable } from '../ui/accounts-table';
import { AccountsToolbar } from '../ui/accounts-toolbar';

import { useAccountListTable } from './use-account-list-table';
import { useAccountTags } from './use-account-tags';

export type MyAccountsPanelProps = {
  platforms: readonly Platform[];
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
};

const toAccountListFilter = (value: string | undefined): AccountListFilter | undefined =>
  value === 'review' || value === 'no-2fa' ? value : undefined;

/** Listado "Mis cuentas": las cuentas con acceso efectivo y las acciones que permiten permiso y nivel. */
export function MyAccountsPanel({ platforms, onEdit, onArchive }: MyAccountsPanelProps) {
  const errorMessage = useErrorMessage();
  // Solo comodidad: se ocultan las acciones sin permiso o nivel, pero el servidor decide siempre.
  const hasUpdatePermission = usePermission('account.update');
  const hasArchivePermission = usePermission('account.archive');

  const timeZone = useMe()?.user.timezone;

  const table = useAccountListTable({
    queryKey: accountsKeys.mine(),
    fetchPage: fetchAccountsPage,
  });
  const tagsQuery = useAccountTags('mine');

  return (
    <AccountsTable
      variant="mine"
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
          showQuickFilters
          tags={tagsQuery.data ?? []}
          tag={table.tag}
          onTagChange={table.onTagChange}
        />
      }
    />
  );
}
