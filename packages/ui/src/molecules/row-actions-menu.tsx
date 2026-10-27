import { lazy, Suspense } from 'react';

import { IconButton } from '../atoms/icon-button';
import { Ellipsis } from '../icons';

export type RowActionItem = {
  id: string;
  /** Ya traducido por el container. */
  label: string;
  onSelect: () => void;
  /** `danger` para acciones destructivas (el container decide si además pide confirmación). */
  tone?: 'default' | 'danger';
};

export type RowActionsMenuProps = {
  /** Nombre accesible del botón (ya traducido; conviene incluir a quién pertenece la fila). */
  label: string;
  items: readonly RowActionItem[];
};

// Carga diferida (ver `row-actions-menu-impl.tsx`): el menú solo se descarga al pintar una fila
// con acciones, no con el JS inicial.
const Impl = lazy(() =>
  import('./row-actions-menu-impl').then((module) => ({ default: module.RowActionsMenuImpl })),
);

/**
 * Menú "⋯" de acciones por fila (docs/frontend.md §6.2) sobre Radix: Enter/Espacio/↓ lo abren,
 * las flechas recorren las opciones, Escape lo cierra y el foco vuelve al botón. No decide qué
 * acciones existen ni autoriza: recibe la lista ya filtrada. Sin opciones no pinta nada.
 * Mientras se descarga el menú se ve el mismo botón, deshabilitado y con el mismo nombre, para que
 * la fila no salte de tamaño.
 */
export function RowActionsMenu({ label, items }: RowActionsMenuProps) {
  if (items.length === 0) return null;
  return (
    <Suspense
      fallback={
        <IconButton
          size="sm"
          label={label}
          disabled
          aria-busy="true"
          icon={<Ellipsis aria-hidden="true" className="size-4" />}
        />
      }
    >
      <Impl label={label} items={items} />
    </Suspense>
  );
}
