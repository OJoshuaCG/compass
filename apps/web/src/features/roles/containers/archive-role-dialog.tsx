import { type Role } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ApiError, useAsyncAction, useRateLimitCooldown } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { archiveRole } from '../api/roles-api';

export type ArchiveRoleDialogProps = {
  role: Role;
  onClose: () => void;
  /** Éxito: el padre cierra el diálogo, avisa y recarga la lista. */
  onDone: () => void;
};

/** Confirmación antes de archivar un rol personalizado (docs/frontend.md §6.2: lo destructivo confirma). */
export function ArchiveRoleDialog({ role, onClose, onDone }: ArchiveRoleDialogProps) {
  const { t } = useTranslation(['roles', 'common']);
  const action = useAsyncAction(() => archiveRole(role.id));
  const cooldown = useRateLimitCooldown(action.error);

  async function confirm() {
    if (cooldown.secondsLeft > 0) return;
    const result = await action.run();
    // 404: el rol ya no existe (otra persona lo archivó): el resultado buscado ya se dio.
    if (result.ok || (result.error instanceof ApiError && result.error.status === 404)) onDone();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('archive.title', { ns: 'roles', name: role.name })}
      description={t('archive.description', { ns: 'roles' })}
      confirmLabel={t('archive.confirm', { ns: 'roles' })}
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
