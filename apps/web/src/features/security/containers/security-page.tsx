import type { Passkey } from '@iam/contracts';
import { Alert, Button, PageHeader, Plus, Spinner } from '@iam/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFixedOrderTable } from '../../../shared/api';
import { useMe } from '../../../shared/auth';
import { useErrorMessage } from '../../../shared/i18n';
import { useLazyCatalog } from '../../../shared/i18n/use-lazy-catalog';
import { useToast } from '../../../shared/toast';
import { fetchMyPasskeysPage, passkeysKeys } from '../api/passkeys-api';
import { PasskeysList } from '../ui/passkeys-list';

import { AddPasskeyDialog } from './add-passkey-dialog';
import { RemovePasskeyDialog } from './remove-passkey-dialog';
import { useWebAuthnSupport } from './use-webauthn-support';

/**
 * Container de `/security`: las llaves de acceso propias en un panel con lista (diseño de Compass), el alta con la
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

  // Pueden cambiar desde otro dispositivo: siempre se recargan al volver a la pantalla.
  const table = useFixedOrderTable({
    queryKey: passkeysKeys.mine(),
    fetchPage: fetchMyPasskeysPage,
  });

  // Hasta que llegan los textos (descarga diferida) no se pinta nada con claves a medias.
  if (!catalogReady) return <Spinner label={t('state.loading', { ns: 'common' })} />;

  const addButton =
    supported === false ? null : (
      <Button
        size="sm"
        onClick={() => {
          setAdding(true);
        }}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t('action.add')}
      </Button>
    );

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {supported === false ? <Alert tone="info">{t('unsupported.message')}</Alert> : null}
      <PasskeysList
        passkeys={table.rows}
        status={table.status}
        errorMessage={errorMessage(table.error)}
        onRetry={table.retry}
        onRemove={setRemoving}
        timeZone={timeZone}
        {...(addButton !== null ? { addAction: addButton } : {})}
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
