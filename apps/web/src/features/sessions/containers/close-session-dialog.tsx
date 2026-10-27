import type { SessionSummary } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revokeMySession } from '../api/sessions-api';
import { describeDevice } from '../model/describe-device';

export type CloseSessionDialogProps = {
  session: SessionSummary;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga la lista. */
  onDone: () => void;
};

/** Confirmación antes de cerrar otra sesión propia (docs/frontend.md §6.2: lo destructivo confirma). */
export function CloseSessionDialog({ session, onClose, onDone }: CloseSessionDialogProps) {
  const { t } = useTranslation(['sessions', 'common']);
  const action = useAsyncAction(() => revokeMySession(session.id));
  const device = describeDevice(session.userAgent) ?? t('device.unknown', { ns: 'sessions' });

  async function confirm() {
    const result = await action.run();
    // 404: la sesión ya no existe (expiró o la cerraron en otro lado): el resultado buscado ya se dio.
    if (result.ok || (result.error instanceof ApiError && result.error.status === 404)) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('close.title', { ns: 'sessions' })}
      description={t('close.description', { ns: 'sessions', device })}
      confirmLabel={t('close.confirm', { ns: 'sessions' })}
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
