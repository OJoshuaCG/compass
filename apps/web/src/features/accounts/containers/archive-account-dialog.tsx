import type { Account } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveAccount } from '../api/accounts-api';

export type ArchiveAccountDialogProps = {
  account: Account;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga los listados. */
  onDone: () => void;
};

/** Confirmación antes de archivar una cuenta (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveAccountDialog({ account, onClose, onDone }: ArchiveAccountDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const action = useAsyncAction(() => archiveAccount(account.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: la cuenta ya no está (otra persona la archivó, o se perdió el acceso): el resultado
    // buscado ya se dio y el servidor no distingue ambos casos a propósito.
    const alreadyGone = result.error instanceof ApiError && result.error.status === 404;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('archive.title', { ns: 'accounts', name: account.displayName })}
      description={t('archive.description', { ns: 'accounts' })}
      confirmLabel={t('archive.confirm', { ns: 'accounts' })}
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
