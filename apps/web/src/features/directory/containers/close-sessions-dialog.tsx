import type { ManagedUser } from '@iam/contracts';
import { ConfirmDialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { useAsyncAction } from '../../../shared/api';
import { ErrorAlert } from '../../../shared/i18n';
import { teamApi } from '../api/team-api';

export type CloseSessionsDialogProps = {
  person: ManagedUser;
  onClose: () => void;
  /** Éxito: recibe el aviso ya traducido; el padre cierra y recarga. */
  onDone: (message: string) => void;
};

/**
 * Confirmación para cerrar todas las sesiones de una persona gestionada. Los textos viven en el
 * catálogo `sessions` (descarga diferida): el padre solo ofrece la acción cuando ya está cargado.
 */
export function CloseSessionsDialog({ person, onClose, onDone }: CloseSessionsDialogProps) {
  const { t } = useTranslation(['sessions', 'common']);
  const action = useAsyncAction(() => teamApi.closeSessions(person.id));

  async function confirm() {
    const result = await action.run();
    if (result.ok) onDone(t('team.toast', { ns: 'sessions', name: person.displayName }));
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('team.title', { ns: 'sessions', name: person.displayName })}
      description={t('team.description', { ns: 'sessions' })}
      confirmLabel={t('team.confirm', { ns: 'sessions' })}
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
