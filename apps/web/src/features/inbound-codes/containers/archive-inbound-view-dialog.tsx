import type { InboundConfigurableView } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveInboundView } from '../api/inbound-api';

export type ArchiveInboundViewDialogProps = {
  view: InboundConfigurableView;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga los listados. */
  onDone: () => void;
};

/** Confirmación antes de archivar una vista (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveInboundViewDialog({ view, onClose, onDone }: ArchiveInboundViewDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const action = useAsyncAction(() => archiveInboundView(view.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: la vista ya no está (otra persona la archivó o se perdió el acceso); el servidor no
    // distingue ambos casos a propósito y el resultado buscado ya se dio.
    const alreadyGone = result.error instanceof ApiError && result.error.status === 404;
    if (alreadyGone) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewSettings.archive.title', { ns: 'inbound', name: view.name })}
      description={t('viewSettings.archive.description', { ns: 'inbound' })}
      confirmLabel={t('viewSettings.archive.confirm', { ns: 'inbound' })}
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
