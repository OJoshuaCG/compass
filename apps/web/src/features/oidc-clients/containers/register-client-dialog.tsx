import type { OidcClientWithSecret, RegisterOidcClientRequest } from '@iam/contracts';
import { Dialog } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { registerOidcClient } from '../api/oidc-clients-api';

import { RegisterClientForm } from './register-client-form';
import { SecretDialog } from './secret-dialog';

export type RegisterClientDialogProps = {
  onClose: () => void;
  /** Éxito: el padre recarga la lista; el secreto NO sale de este componente. */
  onRegistered: () => void;
};

/**
 * Diálogo «Registrar aplicación»: formulario y, al registrar, entrega única del secreto. El
 * secreto vive solo en el estado de este componente (no hay `useMutation`) y el padre lo
 * desmonta al cerrar, así que se descarta. Con la petición en vuelo no se cierra: cerrarlo
 * perdería el secreto de una aplicación que ya se creó.
 */
export function RegisterClientDialog({ onClose, onRegistered }: RegisterClientDialogProps) {
  const { t } = useTranslation(['oidcClients', 'common']);
  const action = useAsyncAction((body: RegisterOidcClientRequest) => registerOidcClient(body));
  const cooldown = useRateLimitCooldown(action.error);
  const [created, setCreated] = useState<OidcClientWithSecret | undefined>(undefined);

  if (created !== undefined) {
    return (
      <SecretDialog
        title={t('registered.title', { ns: 'oidcClients' })}
        description={t('registered.description', { ns: 'oidcClients', name: created.client.name })}
        clientId={created.client.clientId}
        clientSecret={created.clientSecret}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.pending) onClose();
      }}
      title={t('register.title', { ns: 'oidcClients' })}
      description={t('register.description', { ns: 'oidcClients' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <RegisterClientForm
        action={action}
        cooldownSeconds={cooldown.secondsLeft}
        onCancel={onClose}
        onRegistered={(result) => {
          setCreated(result);
          onRegistered();
        }}
      />
    </Dialog>
  );
}
