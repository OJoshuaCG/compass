import type { Credential } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { restoreCredentialVersion } from '../api/credentials-api';

export type RestoreVersionDialogProps = {
  credential: Credential;
  /** Número de la versión anterior que se quiere volver a poner como vigente. */
  version: number;
  onClose: () => void;
  /** Éxito: el padre cierra la confirmación, recarga las consultas y avisa. */
  onDone: () => void;
};

/**
 * Confirmación antes de restaurar una versión anterior de la contraseña. Restaurar no sobrescribe
 * nada: crea una versión nueva con esa contraseña y la vigente queda en el historial. La respuesta
 * solo trae metadatos y la contraseña nunca pasa por este componente. Se usa `useAsyncAction` y no
 * `useMutation` para no dejar datos de la operación en la caché de mutaciones.
 */
export function RestoreVersionDialog({
  credential,
  version,
  onClose,
  onDone,
}: RestoreVersionDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const action = useAsyncAction(() => restoreCredentialVersion(credential.id, version));
  const cooldown = useRateLimitCooldown(action.error);
  const isCoolingDown = cooldown.secondsLeft > 0;

  async function confirm() {
    if (isCoolingDown) return;
    const result = await action.run();
    if (result.ok) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('history.restore.title', { ns: 'credentials', version })}
      description={t('history.restore.description', { ns: 'credentials', version })}
      confirmLabel={t('history.restore.confirm', { ns: 'credentials' })}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      // Durante la espera por 429 solo se bloquea confirmar: `loading` impediría además cerrar el diálogo.
      loading={action.pending}
      confirmDisabled={isCoolingDown}
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
