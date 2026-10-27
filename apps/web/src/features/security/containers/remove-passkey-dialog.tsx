import type { Passkey } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revokeMyPasskey } from '../api/passkeys-api';

export type RemovePasskeyDialogProps = {
  passkey: Passkey;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga la lista. */
  onDone: () => void;
};

/**
 * Confirmación antes de quitar una passkey (docs/frontend.md §6.2: lo destructivo confirma). Si
 * hace falta reautenticar, el cliente HTTP abre el diálogo y reintenta una vez.
 */
export function RemovePasskeyDialog({ passkey, onClose, onDone }: RemovePasskeyDialogProps) {
  const { t } = useTranslation(['security', 'common']);
  const action = useAsyncAction(() => revokeMyPasskey(passkey.id));

  async function confirm() {
    const result = await action.run();
    // 404: ya no existe (la quitaron en otro lado): el resultado buscado ya se dio.
    if (result.ok || (result.error instanceof ApiError && result.error.status === 404)) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('remove.title', { ns: 'security' })}
      description={t('remove.description', { ns: 'security', name: passkey.name })}
      confirmLabel={t('remove.confirm', { ns: 'security' })}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
      tone="danger"
      loading={action.pending}
      onConfirm={() => {
        void confirm();
      }}
    >
      {action.error !== undefined ? <ErrorAlert error={action.error} /> : null}
    </ConfirmDialog>
  );
}
