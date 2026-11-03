import type { InboundSourceSummary } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveInboundSource } from '../api/inbound-api';

export type ArchiveInboundSourceDialogProps = {
  source: InboundSourceSummary;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga los listados. */
  onDone: () => void;
};

/** Confirmación antes de archivar una fuente (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveInboundSourceDialog({
  source,
  onClose,
  onDone,
}: ArchiveInboundSourceDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const action = useAsyncAction(() => archiveInboundSource(source.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404: la fuente ya no está (otra persona la archivó o se perdió el acceso); el servidor no
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
      title={t('sources.archive.title', { ns: 'inbound', name: source.displayName })}
      description={t('sources.archive.description', { ns: 'inbound' })}
      confirmLabel={t('sources.archive.confirm', { ns: 'inbound' })}
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
