import type { TelegramIntegration } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveTelegramIntegration } from '../api/integrations-api';

export type ArchiveTelegramChannelDialogProps = {
  channel: TelegramIntegration;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el canal. */
  onDone: () => void;
};

/** Confirmación antes de archivar el canal (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveTelegramChannelDialog({
  channel,
  onClose,
  onDone,
}: ArchiveTelegramChannelDialogProps) {
  const { t } = useTranslation(['integrations', 'common']);
  const action = useAsyncAction(() => archiveTelegramIntegration(channel.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: el canal ya no está (otra Raíz lo archivó); el resultado buscado ya se dio.
    const alreadyGone = result.error instanceof ApiError && result.error.status === 404;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('telegram.archive.title', { ns: 'integrations', name: channel.name })}
      description={t('telegram.archive.description', { ns: 'integrations' })}
      confirmLabel={t('telegram.archive.confirm', { ns: 'integrations' })}
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
