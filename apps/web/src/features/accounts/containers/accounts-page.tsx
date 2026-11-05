import type { Account } from '@iam/contracts';
import { Button, buttonVariants, PageHeader, Spinner, Tabs } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '../../../shared/auth';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { accountsKeys } from '../api/accounts-api';

import { ArchiveAccountDialog } from './archive-account-dialog';
import { CreateAccountDialog } from './create-account-dialog';
import { EditAccountDialog } from './edit-account-dialog';
import { InventoryPanel } from './inventory-panel';
import { MyAccountsPanel } from './my-accounts-panel';
import { usePlatforms } from './use-platforms';

type DialogState = { kind: 'edit' | 'archive'; account: Account } | { kind: 'create' } | null;

type AccountsView = 'mine' | 'inventory';

/**
 * Container de `/accounts`: "Mis cuentas" con la `DataTable` estándar y, solo con
 * `vault.inventory.read`, la pestaña "Inventario". Crear, editar y archivar se ofrecen según el
 * permiso y el nivel de cada fila; tras cada cambio: aviso y recarga de los listados.
 */
export function AccountsPage() {
  const catalogReady = useLazyCatalog('accounts');
  const { t } = useTranslation(['accounts', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const canCreate = usePermission('account.create');
  const canCreateCredential = usePermission('credential.create');
  const canReadInventory = usePermission('vault.inventory.read');
  const platformsQuery = usePlatforms();
  const [dialog, setDialog] = useState<DialogState>(null);
  // La pestaña vive en memoria: es una vista de la misma pantalla y sus listados no comparten URL.
  const [requestedView, setRequestedView] = useState<AccountsView>('mine');

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  // Si se pierde el permiso con la pestaña abierta, se vuelve a "Mis cuentas" en vez de fallar.
  const view: AccountsView = canReadInventory ? requestedView : 'mine';
  const platforms = platformsQuery.data ?? [];

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: accountsKeys.lists() });
  };
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    reload();
  };

  const panel =
    view === 'inventory' ? (
      <InventoryPanel platforms={platforms} />
    ) : (
      <MyAccountsPanel
        platforms={platforms}
        onEdit={(account) => {
          setDialog({ kind: 'edit', account });
        }}
        onArchive={(account) => {
          setDialog({ kind: 'archive', account });
        }}
      />
    );

  return (
    <>
      <PageHeader
        title={t('title', { ns: 'accounts' })}
        description={t('description', { ns: 'accounts' })}
        actions={
          canCreate ? (
            <>
              {/* Importar crea cuentas y credenciales: se ofrece con ambos permisos; el servidor decide. */}
              {canCreateCredential ? (
                <Link to="/credentials/import" className={buttonVariants({ variant: 'secondary' })}>
                  {t('import.open', { ns: 'accounts' })}
                </Link>
              ) : null}
              <Button
                onClick={() => {
                  setDialog({ kind: 'create' });
                }}
              >
                {t('create.open', { ns: 'accounts' })}
              </Button>
            </>
          ) : undefined
        }
      />
      {canReadInventory ? (
        <Tabs
          label={t('tabs.label', { ns: 'accounts' })}
          tabs={[
            { id: 'mine', label: t('tabs.mine', { ns: 'accounts' }) },
            { id: 'inventory', label: t('tabs.inventory', { ns: 'accounts' }) },
          ]}
          value={view}
          onValueChange={(next) => {
            setRequestedView(next === 'inventory' ? 'inventory' : 'mine');
          }}
        >
          {panel}
        </Tabs>
      ) : (
        panel
      )}
      {canCreate ? (
        <CreateAccountDialog
          open={dialog?.kind === 'create'}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          onCreated={(displayName) => {
            done(t('create.toast', { ns: 'accounts', name: displayName }));
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditAccountDialog
          account={dialog.account}
          onClose={close}
          onUpdated={(displayName) => {
            done(t('edit.toast', { ns: 'accounts', name: displayName }));
          }}
          onReload={() => {
            close();
            reload();
          }}
        />
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveAccountDialog
          account={dialog.account}
          onClose={close}
          onDone={() => {
            done(t('archive.toast', { ns: 'accounts', name: dialog.account.displayName }));
          }}
        />
      ) : null}
    </>
  );
}
