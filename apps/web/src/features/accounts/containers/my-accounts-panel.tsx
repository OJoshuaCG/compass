import type { Account, Platform } from '@iam/contracts';

import { useFixedOrderTable } from '../../../shared/api';
import { usePermission } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { accountsKeys, fetchAccountsPage } from '../api/accounts-api';
import { canArchiveAccount, canEditAccount } from '../model/account-access';
import { AccountsTable } from '../ui/accounts-table';

export type MyAccountsPanelProps = {
  platforms: readonly Platform[];
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
};

/** Listado "Mis cuentas": las cuentas con acceso efectivo y las acciones que permiten permiso y nivel. */
export function MyAccountsPanel({ platforms, onEdit, onArchive }: MyAccountsPanelProps) {
  const errorMessage = useErrorMessage();
  // Solo comodidad: se ocultan las acciones sin permiso o nivel, pero el servidor decide siempre.
  const hasUpdatePermission = usePermission('account.update');
  const hasArchivePermission = usePermission('account.archive');

  const table = useFixedOrderTable({
    queryKey: accountsKeys.mine(),
    fetchPage: fetchAccountsPage,
  });

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
    />
  );
}
