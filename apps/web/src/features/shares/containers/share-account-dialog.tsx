import { Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { createShare } from '../api/shares-api';

import { ShareWithPersonForm } from './share-with-person-form';

export type ShareAccountDialogProps = {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Éxito: recibe el nombre de la persona; el padre avisa y recarga. */
  onShared: (granteeName: string) => void;
};

/**
 * Diálogo "Compartir": busca una persona en el directorio, elige el nivel y una caducidad
 * opcional. Solo comparte con personas: aún no existe un listado de grupos en la API.
 */
export function ShareAccountDialog({
  accountId,
  open,
  onOpenChange,
  onShared,
}: ShareAccountDialogProps) {
  const { t } = useTranslation(['shares', 'common']);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title', { ns: 'shares' })}
      description={t('share.description', { ns: 'shares' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      {/* El formulario se monta solo con el diálogo abierto: al cerrar se descarta lo escrito. */}
      <ShareWithPersonForm
        createShare={(body) => createShare(accountId, body)}
        submitLabel={t('share.submit', { ns: 'shares' })}
        submitHint={t('share.submitHint', { ns: 'shares' })}
        levelOptionLabel={(level) => t(`levelOption.${level}`, { ns: 'shares' })}
        onCancel={() => {
          onOpenChange(false);
        }}
        onShared={onShared}
      />
    </Dialog>
  );
}
