import type { Account } from '@iam/contracts';
import { Button, buttonVariants, PageHeader, Spinner } from '@iam/ui';
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
import { MyAccountsPanel } from './my-accounts-panel';
import { usePlatforms } from './use-platforms';

type DialogState = { kind: 'edit' | 'archive'; account: Account } | { kind: 'create' } | null;

/**
 * Container de `/accounts`: "Mis cuentas" con la `DataTable` estándar. La pantalla ya no ofrece el
 * inventario (decisión del 2026-11-07); el permiso sigue y el Inicio muestra su cifra. Crear, editar
 * y archivar se ofrecen según el permiso y el nivel de cada fila; tras cada cambio: aviso y recarga.
 */
export function AccountsPage() {
  const catalogReady = useLazyCatalog('accounts');
  const { t } = useTranslation(['accounts', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const canCreate = usePermission('account.create');
  const canCreateCredential = usePermission('credential.create');
  const platformsQuery = usePlatforms();
  const [dialog, setDialog] = useState<DialogState>(null);

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const platforms = platformsQuery.data ?? [];

  const close = () => {
    setDialog(null);
  };
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: accountsKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: accountsKeys.tags() });
  };
  const done = (message: string) => {
    toast.show(message, 'success');
    setDialog(null);
    reload();
  };

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
      <MyAccountsPanel
        platforms={platforms}
        onEdit={(account) => {
          setDialog({ kind: 'edit', account });
        }}
        onArchive={(account) => {
          setDialog({ kind: 'archive', account });
        }}
      />
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
