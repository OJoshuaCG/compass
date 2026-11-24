import { Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { SecretPanel } from '../ui/secret-panel';

export type SecretDialogProps = {
  title: string;
  description: string;
  clientId: string;
  clientSecret: string;
  onClose: () => void;
};

/**
 * Diálogo que entrega el secreto una sola vez. No guarda nada: el padre lo monta mientras tiene
 * el secreto en su estado local y, al cerrarse, lo desmonta y el secreto se descarta.
 */
export function SecretDialog({
  title,
  description,
  clientId,
  clientSecret,
  onClose,
}: SecretDialogProps) {
  const { t } = useTranslation('common');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
    >
      <SecretPanel clientId={clientId} clientSecret={clientSecret} onDone={onClose} />
    </Dialog>
  );
}
