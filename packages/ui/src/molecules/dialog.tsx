import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { X } from '../icons';
import { cn } from '../lib/cn';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Nombre accesible del botón de cierre (ya traducido). */
  closeLabel: string;
  /**
   * `side`: panel a la altura completa pegado al borde final, para consultar el detalle de un
   * elemento sin perder de vista la lista. Mismo comportamiento modal que el centrado.
   */
  placement?: 'center' | 'side';
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
  placement = 'center',
  children,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* z-50 > z-40 del aviso emergente: el aviso nunca tapa los botones de un diálogo abierto. */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 scrim" />
        <RadixDialog.Content
          className={cn(
            // Cristal: es una capa flotante (ADR 0049); el panel lateral solo redondea su borde libre.
            'fixed z-50 overflow-y-auto glass p-6',
            placement === 'side'
              ? 'inset-y-0 end-0 w-full max-w-md rounded-s-lg'
              : 'inset-x-4 top-1/2 mx-auto max-h-dvh max-w-md -translate-y-1/2 rounded-lg',
          )}
        >
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
