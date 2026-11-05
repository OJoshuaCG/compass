import type { InboundConfigurableView } from '@iam/contracts';
import { Dialog } from '@iam/ui';
import { useTranslation } from 'react-i18next';

import { ShareWithPersonForm } from '../../shares';
import { createInboundViewShare } from '../api/inbound-api';

export type ShareInboundViewDialogProps = {
  view: InboundConfigurableView;
  onClose: () => void;
  /** Éxito: recibe el nombre de la persona; el padre cierra, avisa y recarga. */
  onShared: (granteeName: string) => void;
};

/**
 * Diálogo "Compartir la vista": el formulario común de compartir con una persona, con los textos y el
 * significado de cada nivel propios de una vista de códigos. Lo monta el padre solo mientras está
 * abierto, así que lo escrito se descarta al cerrar.
 */
export function ShareInboundViewDialog({ view, onClose, onShared }: ShareInboundViewDialogProps) {
  const { t } = useTranslation(['inbound', 'common']);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('viewSettings.shares.share.title', { ns: 'inbound', name: view.name })}
      description={t('viewSettings.shares.share.description', { ns: 'inbound' })}
      closeLabel={t('dialog.close', { ns: 'common' })}
    >
      <ShareWithPersonForm
        createShare={(body) => createInboundViewShare(view.id, body)}
        submitLabel={t('viewSettings.shares.share.submit', { ns: 'inbound' })}
        submitHint={t('viewSettings.shares.share.submitHint', { ns: 'inbound' })}
        levelOptionLabel={(level) =>
          t(`viewSettings.shares.levelOption.${level}`, { ns: 'inbound' })
        }
        onCancel={onClose}
        onShared={onShared}
      />
    </Dialog>
  );
}
