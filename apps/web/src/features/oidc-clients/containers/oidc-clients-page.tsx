import type { OidcClient } from '@iam/contracts';
import { Button, PageHeader, Plus, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchOidcClients, oidcClientsKeys } from '../api/oidc-clients-api';
import { OidcClientsTable } from '../ui/oidc-clients-table';

import { DisableClientDialog } from './disable-client-dialog';
import { RegisterClientDialog } from './register-client-dialog';
import { RotateSecretDialog } from './rotate-secret-dialog';

type DialogState =
  | { kind: 'register' }
  | { kind: 'rotate'; client: OidcClient }
  | { kind: 'disable'; client: OidcClient }
  | null;

/**
 * Container de `/sso/clients`: las aplicaciones que usan Compass como SSO, con registro, rotación
 * de secreto y deshabilitado. Cada acción pide reautenticación a través del cliente HTTP; el
 * permiso `sso.clients.manage` lo comprueba la ruta como comodidad y el servidor decide siempre.
 * El listado nunca trae secretos: los que devuelven registrar y rotar viven solo en el diálogo.
 */
export function OidcClientsPage() {
  const catalogReady = useLazyCatalog('oidcClients');
  const { t } = useTranslation(['oidcClients', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [dialog, setDialog] = useState<DialogState>(null);

  const clientsQuery = useQuery({
    queryKey: oidcClientsKeys.list(),
    queryFn: ({ signal }) => fetchOidcClients(signal),
    staleTime: 0,
  });

  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const tableStatus = clientsQuery.isPending
    ? 'loading'
    : clientsQuery.isError
      ? 'error'
      : 'success';

  function reloadList() {
    void queryClient.invalidateQueries({ queryKey: oidcClientsKeys.list() });
  }

  function openRegister() {
    setDialog({ kind: 'register' });
  }

  const registerLabel = t('action.register', { ns: 'oidcClients' });

  return (
    <>
      <PageHeader
        eyebrow={t('nav.group.access', { ns: 'common' })}
        title={t('title', { ns: 'oidcClients' })}
        description={t('description', { ns: 'oidcClients' })}
        actions={
          <Button onClick={openRegister}>
            <Plus aria-hidden="true" className="size-4" />
            {registerLabel}
          </Button>
        }
      />
      <OidcClientsTable
        clients={clientsQuery.data ?? []}
        status={tableStatus}
        errorMessage={errorMessage(clientsQuery.error)}
        onRetry={() => {
          void clientsQuery.refetch();
        }}
        timeZone={me?.user.timezone}
        emptyAction={<Button onClick={openRegister}>{registerLabel}</Button>}
        onRotate={(client) => {
          setDialog({ kind: 'rotate', client });
        }}
        onDisable={(client) => {
          setDialog({ kind: 'disable', client });
        }}
      />
      {dialog?.kind === 'register' ? (
        <RegisterClientDialog
          onClose={() => {
            setDialog(null);
          }}
          onRegistered={reloadList}
        />
      ) : null}
      {dialog?.kind === 'rotate' ? (
        <RotateSecretDialog
          client={dialog.client}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'disable' ? (
        <DisableClientDialog
          client={dialog.client}
          onClose={() => {
            setDialog(null);
          }}
          onDone={() => {
            toast.show(
              t('disable.toast', { ns: 'oidcClients', name: dialog.client.name }),
              'success',
            );
            setDialog(null);
            reloadList();
          }}
        />
      ) : null}
    </>
  );
}
