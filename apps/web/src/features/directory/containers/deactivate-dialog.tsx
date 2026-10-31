import type { ManagedUser } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { teamApi } from '../api/team-api';

export type DeactivateDialogProps = {
  person: ManagedUser;
  onClose: () => void;
  /** Éxito: recibe el aviso ya traducido; el padre cierra y recarga. */
  onDone: (message: string) => void;
};

/**
 * Confirmación de la baja. Es irreversible y reasigna a los subordinados directos al responsable
 * de la persona, por eso nunca se ejecuta sin pasar por aquí (docs/frontend.md §6.2).
 */
export function DeactivateDialog({ person, onClose, onDone }: DeactivateDialogProps) {
  const { t } = useTranslation(['directory', 'common']);
  const action = useAsyncAction(() => teamApi.deactivate(person.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    if (result.ok) {
      onDone(t('team.toast.deactivated', { ns: 'directory', name: person.displayName }));
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('deactivate.title', { ns: 'directory', name: person.displayName })}
      description={t('deactivate.description', { ns: 'directory' })}
      confirmLabel={t('deactivate.confirm', { ns: 'directory' })}
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
