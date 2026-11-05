import type { InboundViewShare } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { revokeInboundViewShare } from '../api/inbound-api';

export type RevokeInboundViewShareDialogProps = {
  share: InboundViewShare;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga el listado. */
  onDone: () => void;
  /** 404: el acceso o la vista ya no están al alcance de la persona; el padre recarga los listados. */
  onStale: () => void;
};

/**
 * Confirmación antes de revocar el acceso a una vista (docs/frontend.md §6.2: lo destructivo
 * confirma). El texto avisa de la tarea de rotación: si la fuente está ligada a una cuenta y la persona
 * reveló un restablecimiento, el enlace puede seguir sirviendo aunque ya no vea la vista.
 */
export function RevokeInboundViewShareDialog({
  share,
  onClose,
  onDone,
  onStale,
}: RevokeInboundViewShareDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const action = useAsyncAction(() => revokeInboundViewShare(share.viewId, share.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone();
      return;
    }
    // 404 no prueba que el acceso se haya revocado: el servidor responde igual si otra persona ya lo
    // revocó y si quien revoca perdió la vista o esta se archivó. Por eso no se anuncia éxito: el error
    // queda a la vista y se recargan los listados para mostrar el estado real.
    const stale = result.error instanceof ApiError && result.error.status === 404;
    if (stale) onStale();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewSettings.shares.revoke.title', { ns: 'inbound', name: share.granteeName })}
      description={t('viewSettings.shares.revoke.description', {
        ns: 'inbound',
        name: share.granteeName,
      })}
      confirmLabel={t('viewSettings.shares.revoke.confirm', { ns: 'inbound' })}
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
