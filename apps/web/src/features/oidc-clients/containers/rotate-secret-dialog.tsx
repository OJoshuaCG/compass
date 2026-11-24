import type { OidcClient, OidcClientWithSecret } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { rotateOidcClientSecret } from '../api/oidc-clients-api';

import { SecretDialog } from './secret-dialog';

export type RotateSecretDialogProps = {
  client: OidcClient;
  onClose: () => void;
};

/**
 * Rotar el secreto: confirmación destructiva (el secreto vigente deja de valer) y, al terminar,
 * entrega única del nuevo. El secreto vive solo en este estado local: la acción no pasa por
 * `useMutation` y al cerrar el diálogo el padre lo desmonta. Pide reautenticación vía el cliente HTTP.
 */
export function RotateSecretDialog({ client, onClose }: RotateSecretDialogProps) {
  const { t } = useTranslation(['oidcClients', 'common']);
  const action = useAsyncAction(() => rotateOidcClientSecret(client.id));
  const cooldown = useRateLimitCooldown(action.error);
  const [rotated, setRotated] = useState<OidcClientWithSecret | undefined>(undefined);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) setRotated(result.value);
  }

  if (rotated !== undefined) {
    return (
      <SecretDialog
        title={t('rotated.title', { ns: 'oidcClients' })}
        description={t('rotated.description', { ns: 'oidcClients', name: rotated.client.name })}
        clientId={rotated.client.clientId}
        clientSecret={rotated.clientSecret}
        onClose={onClose}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('rotate.title', { ns: 'oidcClients', name: client.name })}
      description={t('rotate.description', { ns: 'oidcClients' })}
      confirmLabel={t('rotate.confirm', { ns: 'oidcClients' })}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      tone="danger"
      loading={action.pending}
      confirmDisabled={cooldown.secondsLeft > 0}
      onConfirm={() => {
        void confirm();
      }}
    >
      {action.error !== undefined ? (
        <ErrorAlert error={action.error} secondsLeft={cooldown.secondsLeft} />
      ) : null}
    </ConfirmDialog>
  );
}
