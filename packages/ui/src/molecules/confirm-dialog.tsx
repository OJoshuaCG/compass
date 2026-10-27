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
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-canvas/80" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 mx-auto max-w-md -translate-y-1/2 rounded-lg border border-border-strong bg-overlay p-6 shadow-overlay">
          <Dialog.Title className="font-heading text-lg text-text">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-text-secondary">
            {description}
          </Dialog.Description>
          {children !== undefined ? <div className="mt-4">{children}</div> : null}
          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="secondary">{cancelLabel}</Button>
            </Dialog.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
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
