import type { RootTransfer } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { acceptRootTransfer, cancelRootTransfer } from '../api/root-transfer-api';

export type AcceptRootTransferDialogProps = {
  onClose: () => void;
  /** Éxito: el padre guarda la transferencia aceptada y avisa. */
  onAccepted: (transfer: RootTransfer) => void;
  /** 404: la propuesta ya no existe (se canceló o caducó); el padre recarga. */
  onGone: () => void;
};

/**
 * Confirmación antes de aceptar el puesto de Raíz. Aceptar inicia las 72 horas de espera; el
 * servidor exige reautenticación reciente y el cliente base la abre y reintenta una vez.
 */
export function AcceptRootTransferDialog({
  onClose,
  onAccepted,
  onGone,
}: AcceptRootTransferDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const action = useAsyncAction(() => acceptRootTransfer());
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onAccepted(result.value);
      return;
    }
    if (result.error instanceof ApiError && result.error.status === 404) onGone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('rootTransfer.accept.title')}
      description={t('rootTransfer.accept.description')}
      confirmLabel={t('rootTransfer.accept.confirm')}
      cancelLabel={t('actions.cancel', { ns: 'common' })}
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

export type CancelRootTransferDialogProps = {
  onClose: () => void;
  /** Éxito, o la transferencia ya no existía: el resultado buscado ya se dio. */
  onCancelled: () => void;
};

/** Confirmación antes de detener la transferencia abierta (docs/frontend.md §6.2: lo destructivo confirma). */
export function CancelRootTransferDialog({ onClose, onCancelled }: CancelRootTransferDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const action = useAsyncAction(() => cancelRootTransfer());
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onCancelled();
      return;
    }
    // 404: otra persona ya la canceló o caducó; el estado buscado ya se dio.
    if (result.error instanceof ApiError && result.error.status === 404) onCancelled();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('rootTransfer.cancel.title')}
      description={t('rootTransfer.cancel.description')}
      confirmLabel={t('rootTransfer.cancel.confirm')}
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
