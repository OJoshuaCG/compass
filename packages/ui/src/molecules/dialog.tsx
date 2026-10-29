import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { X } from '../icons';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Nombre accesible del botón de cierre (ya traducido). */
  closeLabel: string;
  children: ReactNode;
};

/**
 * Diálogo modal genérico sobre Radix (foco atrapado, Escape, `aria-modal` y devolución del
 * foco). Para formularios; las confirmaciones destructivas usan `ConfirmDialog`.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* z-50 > z-40 del aviso emergente: el aviso nunca tapa los botones de un diálogo abierto. */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-canvas/80" />
        <RadixDialog.Content className="fixed inset-x-4 z-50 top-1/2 mx-auto max-h-dvh max-w-md -translate-y-1/2 overflow-y-auto rounded-lg border border-border-strong bg-overlay p-6 shadow-overlay">
          <RadixDialog.Title className="pe-8 font-heading text-lg break-words text-text">
            {title}
          </RadixDialog.Title>
          <RadixDialog.Description className="mt-2 text-sm text-text-secondary">
            {description}
          </RadixDialog.Description>
          <div className="mt-4">{children}</div>
          <RadixDialog.Close
            aria-label={closeLabel}
            className="absolute end-3 top-3 inline-flex size-8 items-center justify-center rounded-sm text-text-secondary hover:bg-raised hover:text-text"
          >
            <X aria-hidden="true" className="size-4" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
