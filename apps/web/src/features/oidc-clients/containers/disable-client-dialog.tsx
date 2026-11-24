import { ErrorCode, type OidcClient } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { disableOidcClient } from '../api/oidc-clients-api';

export type DisableClientDialogProps = {
  client: OidcClient;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga la lista. */
  onDone: () => void;
};

/** Códigos que significan «ya está como se pidió»: otra persona la deshabilitó o ya no existe. */
function alreadyGone(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.code === ErrorCode.FEDERATION_CLIENT_DISABLED)
  );
}

/** Confirmación antes de deshabilitar una aplicación (no se puede reactivar; docs/frontend.md §6.2). */
export function DisableClientDialog({ client, onClose, onDone }: DisableClientDialogProps) {
  const { t } = useTranslation(['oidcClients', 'common']);
  const action = useAsyncAction(() => disableOidcClient(client.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok || alreadyGone(result.error)) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('disable.title', { ns: 'oidcClients', name: client.name })}
      description={t('disable.description', { ns: 'oidcClients' })}
      confirmLabel={t('disable.confirm', { ns: 'oidcClients' })}
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
