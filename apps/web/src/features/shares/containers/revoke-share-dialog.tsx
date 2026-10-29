import type { Share } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revokeShare } from '../api/shares-api';

export type RevokeShareDialogProps = {
  share: Share;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el listado. */
  onDone: () => void;
};

/**
 * Confirmación antes de revocar un acceso (docs/frontend.md §6.2: lo destructivo confirma). El
 * texto avisa de la tarea de rotación porque revocar no deshace lo que la persona ya pudo ver.
 */
export function RevokeShareDialog({ share, onClose, onDone }: RevokeShareDialogProps) {
  const { t } = useTranslation(['shares', 'common']);
  const action = useAsyncAction(() => revokeShare(share.accountId, share.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: el acceso ya no existe (otra persona lo revocó): el resultado buscado ya se dio.
    const alreadyGone = result.error instanceof ApiError && result.error.status === 404;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('revoke.title', { ns: 'shares', name: share.granteeName })}
      description={t('revoke.description', { ns: 'shares', name: share.granteeName })}
      confirmLabel={t('revoke.confirm', { ns: 'shares' })}
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
