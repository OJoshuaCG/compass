import type { Passkey } from '@iam/contracts';
import { Alert, Button, PageHeader, Spinner } from '@iam/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchMyPasskeys, passkeysKeys } from '../api/passkeys-api';
import { PasskeysTable } from '../ui/passkeys-table';

import { AddPasskeyDialog } from './add-passkey-dialog';
import { RemovePasskeyDialog } from './remove-passkey-dialog';
import { useWebAuthnSupport } from './use-webauthn-support';

/**
 * Container de `/security`: las passkeys propias con la `DataTable` estándar, el alta con la
 * ceremonia de registro y la baja con confirmación. Sin soporte de WebAuthn no hay botón de alta,
 * sino una explicación (el código de la aplicación autenticadora sigue valiendo).
 */
export function SecurityPage() {
  const catalogReady = useLazyCatalog('security');
  const { t } = useTranslation(['security', 'common']);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const toast = useToast();
  const timeZone = useMe()?.user.timezone;
  const supported = useWebAuthnSupport();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Passkey | null>(null);

  const query = useQuery({
    queryKey: passkeysKeys.mine(),
    queryFn: ({ signal }) => fetchMyPasskeys(signal),
    // Pueden cambiar desde otro dispositivo: siempre se recargan al volver a la pantalla.
    staleTime: 0,
  });

  // Hasta que llegan los textos (descarga diferida) no se pinta nada con claves a medias.
  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'success';
  const addButton =
    supported === false ? null : (
      <Button
        onClick={() => {
          setAdding(true);
        }}
      >
        {t('action.add')}
      </Button>
    );

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} actions={addButton} />
      {supported === false ? <Alert tone="info">{t('unsupported.message')}</Alert> : null}
      <PasskeysTable
        passkeys={query.data ?? []}
        status={status}
        errorMessage={errorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        onRemove={setRemoving}
        timeZone={timeZone}
        refreshing={query.isFetching && !query.isPending}
      />
      <AddPasskeyDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(name) => {
          setAdding(false);
          toast.show(t('add.toast', { name }), 'success');
          void queryClient.invalidateQueries({ queryKey: passkeysKeys.all });
        }}
      />
      {removing !== null ? (
        <RemovePasskeyDialog
          passkey={removing}
          onClose={() => {
            setRemoving(null);
          }}
          onDone={() => {
            setRemoving(null);
            toast.show(t('remove.toast'), 'success');
            void queryClient.invalidateQueries({ queryKey: passkeysKeys.all });
          }}
        />
      ) : null}
    </>
  );
}
