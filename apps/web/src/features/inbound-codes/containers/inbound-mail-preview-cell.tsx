import { Button, Dialog } from '@iam/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InboundMailPreviewContent } from './inbound-mail-preview-content';

export type InboundMailPreviewCellProps = {
  receiptId: string;
  /** Texto con el que se nombra el mensaje (fecha de recepción) en los nombres accesibles. */
  receivedAtLabel: string;
  /** Ofrece también el cuerpo completo (permiso `inbound.reveal_reset`). Solo comodidad: el servidor decide. */
  canViewBody: boolean;
};

/**
 * Acción «Ver correo» de una fila del historial. El diálogo solo se monta mientras está abierto: al
 * cerrarlo (o al desmontar la fila) se desmonta `InboundMailPreviewContent` y con él se descartan el
 * asunto y el cuerpo, que viven únicamente en su estado local.
 */
export function InboundMailPreviewCell({
  receiptId,
  receivedAtLabel,
  canViewBody,
}: InboundMailPreviewCellProps) {
  const { t } = useTranslation(['inbound', 'common']);
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasBeenOpened = useRef(false);

  // El diálogo se monta ya abierto y sin el `Trigger` de Radix, así que Radix no sabe a qué elemento devolver el
  // foco al cerrar. Se devuelve aquí, ya con el diálogo desmontado y sin la trampa de foco activa.
  useEffect(() => {
    if (dialogOpen) {
      hasBeenOpened.current = true;
      return;
    }
    if (hasBeenOpened.current) triggerRef.current?.focus();
  }, [dialogOpen]);

  function closeDialog() {
    setDialogOpen(false);
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-label={t('mailPreview.openLabel', { received: receivedAtLabel })}
        onClick={() => {
          setDialogOpen(true);
        }}
      >
        {t('mailPreview.open')}
      </Button>
      {dialogOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          title={t('mailPreview.dialog.title', { received: receivedAtLabel })}
          description={t('mailPreview.dialog.description')}
          closeLabel={t('actions.close', { ns: 'common' })}
        >
          <InboundMailPreviewContent
            receiptId={receiptId}
            canViewBody={canViewBody}
            onClose={closeDialog}
          />
        </Dialog>
      ) : null}
    </>
  );
}
