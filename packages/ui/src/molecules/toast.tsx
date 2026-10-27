import { cva } from 'class-variance-authority';

import { CheckCircle2, Info, X, XCircle } from '../icons';

export type ToastItem = {
  id: string;
  message: string;
  tone: 'success' | 'danger' | 'info';
};

export type ToastViewportProps = {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  /** Nombre accesible del botón de cerrar (ya traducido). */
  dismissLabel: string;
  /** Nombre accesible de la región de avisos (ya traducido). */
  regionLabel: string;
};

const toast = cva(
  'pointer-events-auto flex items-start gap-3 rounded-md border bg-overlay px-4 py-3 text-sm text-text shadow-overlay',
  {
    variants: {
      tone: {
        success: 'border-success',
        danger: 'border-danger',
        info: 'border-border-strong',
      },
    },
  },
);

const icons = { success: CheckCircle2, danger: XCircle, info: Info };

/**
 * Región de avisos efímeros. La región `role="status"` (aria-live polite) siempre está en el
 * DOM: los lectores de pantalla solo anuncian contenido que aparece dentro de una región que
 * ya existía. El temporizador de cierre lo gestiona quien guarda la lista.
 */
export function ToastViewport({
  toasts,
  onDismiss,
  dismissLabel,
  regionLabel,
}: ToastViewportProps) {
  return (
    <div
      role="status"
      aria-label={regionLabel}
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 ms-auto flex max-w-sm flex-col gap-2"
    >
      {toasts.map((item) => {
        const Icon = icons[item.tone];
        return (
          <div key={item.id} className={toast({ tone: item.tone })}>
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1 break-words">{item.message}</p>
            <button
              type="button"
              aria-label={dismissLabel}
              onClick={() => {
                onDismiss(item.id);
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-raised hover:text-text"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
