import type { Platform } from '@iam/contracts';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useErrorMessage } from '../../../shared/i18n';
import { accountsKeys, fetchInventoryPage } from '../api/accounts-api';
import { AccountsTable } from '../ui/accounts-table';

export type InventoryPanelProps = {
  platforms: readonly Platform[];
};

/** Inventario de la organización: metadatos de todas las cuentas activas, sin acciones ni acceso. */
export function InventoryPanel({ platforms }: InventoryPanelProps) {
  const { t } = useTranslation('accounts');
  const errorMessage = useErrorMessage();

  const table = useFixedOrderTable({
    queryKey: accountsKeys.inventory(),
    fetchPage: fetchInventoryPage,
  });

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
      />
    </div>
  );
}
