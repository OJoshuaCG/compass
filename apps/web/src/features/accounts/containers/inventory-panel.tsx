import type { Platform } from '@iam/contracts';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { accountsKeys, fetchInventoryPage } from '../api/accounts-api';
import { AccountsTable } from '../ui/accounts-table';
import { AccountsToolbar } from '../ui/accounts-toolbar';

import { useAccountListTable } from './use-account-list-table';
import { useAccountTags } from './use-account-tags';

export type InventoryPanelProps = {
  platforms: readonly Platform[];
};

/** Inventario de la organización: metadatos de todas las cuentas activas, sin acciones ni acceso. */
export function InventoryPanel({ platforms }: InventoryPanelProps) {
  const { t } = useTranslation('accounts');
  const errorMessage = useErrorMessage();

  const timeZone = useMe()?.user.timezone;

  const table = useAccountListTable({
    queryKey: accountsKeys.inventory(),
    fetchPage: fetchInventoryPage,
  });
  const tagsQuery = useAccountTags('inventory');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">{t('inventory.description')}</p>
      <AccountsTable
        variant="inventory"
        accounts={table.rows}
        platforms={platforms}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        canEdit={() => false}
        canArchive={() => false}
        onEdit={() => undefined}
        onArchive={() => undefined}
        refreshing={table.refreshing}
        paging={table}
        hasActiveFilters={table.hasActiveFilters}
        onClearFilters={table.clearFilters}
        timeZone={timeZone}
        toolbar={
          <AccountsToolbar
            searchDraft={table.draft}
            onSearchChange={table.setDraft}
            filter={undefined}
            onFilterChange={table.onFilterChange}
            showQuickFilters={false}
            tags={tagsQuery.data ?? []}
            tag={table.tag}
            onTagChange={table.onTagChange}
          />
        }
      />
    </div>
  );
}
