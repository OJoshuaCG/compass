import { ErrorCode, type Credential } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { retireTotp } from '../api/totp-api';

export type TotpRetireDialogProps = {
  credential: Credential;
  onClose: () => void;
  /** Éxito: el padre cierra la confirmación y recarga el estado. */
  onDone: () => void;
};

/**
 * Confirmación antes de retirar el segundo factor (docs/frontend.md §6.2: lo destructivo confirma).
 * El texto avisa de que queda marcado en la salud de la credencial y de que, para volver a usarlo,
 * hay que registrarlo de nuevo.
 */
export function TotpRetireDialog({ credential, onClose, onDone }: TotpRetireDialogProps) {
  const { t } = useTranslation(['credentials', 'common']);
  const action = useAsyncAction(() => retireTotp(credential.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // Estado inválido: otra persona ya lo retiró; el resultado buscado ya se dio.
    const alreadyRetired =
      result.error instanceof ApiError &&
      result.error.code === ErrorCode.CREDENTIAL_TOTP_STATE_INVALID;
    if (alreadyRetired) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('totp.retire.title', { ns: 'credentials', label: credential.label })}
      description={t('totp.retire.description', { ns: 'credentials' })}
      confirmLabel={t('totp.retire.confirm', { ns: 'credentials' })}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      tone="danger"
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
