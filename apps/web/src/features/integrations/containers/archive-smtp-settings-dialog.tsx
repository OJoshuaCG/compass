import type { SmtpSettings } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveSmtpSettings } from '../api/integrations-api';

export type ArchiveSmtpSettingsDialogProps = {
  settings: SmtpSettings;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el servidor. */
  onDone: () => void;
};

/** Confirmación antes de archivar el servidor (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveSmtpSettingsDialog({
  settings,
  onClose,
  onDone,
}: ArchiveSmtpSettingsDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const action = useAsyncAction(() => archiveSmtpSettings(settings.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: el servidor ya no está (otra Raíz lo archivó); el resultado buscado ya se dio.
    const alreadyGone = result.error instanceof ApiError && result.error.status === 404;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('smtp.archive.title', { ns: 'integrations', name: settings.name })}
      description={t('smtp.archive.description', { ns: 'integrations' })}
      confirmLabel={t('smtp.archive.confirm', { ns: 'integrations' })}
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
