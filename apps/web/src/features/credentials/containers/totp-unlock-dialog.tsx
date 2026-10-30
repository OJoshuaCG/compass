import { ErrorCode, type Credential } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { unlockTotpConfirmation } from '../api/totp-api';

export type TotpUnlockDialogProps = {
  credential: Credential;
  onClose: () => void;
  /** Éxito: el padre cierra la confirmación y recarga el estado. */
  onDone: () => void;
};

/**
 * Confirmación antes de desbloquear la confirmación del segundo factor. Avisa de que no puede hacerlo quien
 * registró el factor y de que el siguiente bloqueo será más largo: el servidor decide siempre.
 */
export function TotpUnlockDialog({ credential, onClose, onDone }: TotpUnlockDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const action = useAsyncAction(() => unlockTotpConfirmation(credential.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // Ya no estaba bloqueado (venció o lo desbloqueó otra persona): el resultado buscado ya se dio.
    const alreadyUnlocked =
      result.error instanceof ApiError &&
      result.error.code === ErrorCode.CREDENTIAL_TOTP_NOT_LOCKED;
    if (alreadyUnlocked) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('totp.unlock.title', { ns: 'credentials', label: credential.label })}
      description={t('totp.unlock.description', { ns: 'credentials' })}
      confirmLabel={t('totp.unlock.confirm', { ns: 'credentials' })}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      loading={action.pending}
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
