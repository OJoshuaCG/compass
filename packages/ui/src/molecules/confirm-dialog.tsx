import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { Button } from '../atoms/button';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** `danger` para acciones destructivas. */
  tone?: 'default' | 'danger';
  /** Mientras la mutación corre: el botón queda en `loading` y se evita el doble envío. */
  loading?: boolean;
  /**
   * Bloquea la confirmación sin bloquear el cierre (por ejemplo, durante la espera de un 429).
   * `loading` no sirve para eso: además de la confirmación inmovilizaría Cancelar y Escape.
   */
  confirmDisabled?: boolean;
  /** Contenido extra bajo la descripción (por ejemplo, el error de la operación). */
  children?: ReactNode;
};

/**
 * Diálogo de confirmación sobre Radix (foco atrapado, Escape, `aria-modal` y devolución
 * del foco los gestiona la primitiva). Toda acción destructiva debe pasar por aquí.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = 'default',
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  // Con la mutación en vuelo no se puede cerrar (Escape, clic fuera o Cancelar): si el diálogo
  // se desmontara, la persona perdería el resultado de una acción que ya salió al servidor.
  function handleOpenChange(nextOpen: boolean) {
    if (loading && !nextOpen) return;
    onOpenChange(nextOpen);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* z-50 > z-40 del aviso emergente: el aviso nunca tapa los botones de un diálogo abierto. */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-canvas/80" />
        <Dialog.Content className="fixed inset-x-4 z-50 top-1/2 mx-auto max-h-dvh max-w-md -translate-y-1/2 overflow-y-auto rounded-lg border border-border-strong bg-overlay p-6 shadow-overlay">
          <Dialog.Title className="font-heading text-lg break-words text-text">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-text-secondary">
            {description}
          </Dialog.Description>
          {children !== undefined ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={loading}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
