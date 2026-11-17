import { ErrorCode, type SavedAccountView } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { deleteSavedView } from '../api/accounts-api';

export type DeleteSavedViewDialogProps = {
  view: SavedAccountView;
  onClose: () => void;
  /** Éxito (o la vista ya no existía): el padre cierra, avisa y recarga las vistas. */
  onDone: () => void;
};

/** Confirmación antes de borrar una vista guardada (docs/frontend.md §6.2: lo destructivo confirma). */
export function DeleteSavedViewDialog({ view, onClose, onDone }: DeleteSavedViewDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const action = useAsyncAction(() => deleteSavedView(view.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: otra sesión ya la borró; el resultado buscado ya se dio.
    const alreadyGone =
      result.error instanceof ApiError && result.error.code === ErrorCode.SAVED_VIEW_NOT_FOUND;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('views.deleteTitle', { ns: 'accounts', name: view.name })}
      description={t('views.deleteDescription', { ns: 'accounts' })}
      confirmLabel={t('views.deleteConfirm', { ns: 'accounts' })}
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
