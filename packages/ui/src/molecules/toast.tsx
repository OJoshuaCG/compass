import { cva } from 'class-variance-authority';
import { useRef } from 'react';

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
  /**
   * Avisa de que el puntero o el foco entran (`held: true`) o salen (`held: false`) de un aviso.
   * Quien guarda la lista usa esto para pausar el cierre automático (WCAG 2.2.1).
   */
  onHoldChange?: (id: string, held: boolean) => void;
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

type ToastCardProps = {
  item: ToastItem;
  onDismiss: (id: string) => void;
  dismissLabel: string;
  onHoldChange: ((id: string, held: boolean) => void) | undefined;
};

/**
 * Un aviso. Recuerda por separado si el puntero está encima y si el foco está dentro: el cierre
 * automático solo se reanuda cuando ninguna de las dos condiciones sigue activa.
 */
function ToastCard({ item, onDismiss, dismissLabel, onHoldChange }: ToastCardProps) {
  const Icon = icons[item.tone];
  const pointerInside = useRef(false);
  const focusInside = useRef(false);

  function reportHold() {
    onHoldChange?.(item.id, pointerInside.current || focusInside.current);
  }

  return (
    <div
      className={toast({ tone: item.tone })}
      onPointerEnter={() => {
        pointerInside.current = true;
        reportHold();
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        reportHold();
      }}
      onFocus={() => {
        focusInside.current = true;
        reportHold();
      }}
      onBlur={(event) => {
        // El foco que pasa de un hijo a otro del mismo aviso no cuenta como salida.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focusInside.current = false;
        reportHold();
      }}
    >
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
}

/**
 * Región de avisos efímeros. La región `role="status"` (aria-live polite) siempre está en el
 * DOM: los lectores de pantalla solo anuncian contenido que aparece dentro de una región que
 * ya existía. El temporizador de cierre lo gestiona quien guarda la lista; este componente solo
 * le informa cuándo el puntero o el foco retienen un aviso (`onHoldChange`).
 */
export function ToastViewport({
  toasts,
  onDismiss,
  dismissLabel,
  regionLabel,
  onHoldChange,
}: ToastViewportProps) {
  return (
    <div
      role="status"
      aria-label={regionLabel}
      // z-40, por debajo de diálogos y menús (z-50): un aviso no debe tapar sus botones. Bajo el
      // fondo de un diálogo el aviso se atenúa, pero sigue anunciándose por la región activa.
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 ms-auto flex max-w-sm flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onDismiss={onDismiss}
          dismissLabel={dismissLabel}
          onHoldChange={onHoldChange}
        />
      ))}
    </div>
  );
}
