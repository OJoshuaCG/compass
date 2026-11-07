import { lazy, Suspense, type ReactNode } from 'react';

import { UserMenuTriggerContent } from './user-menu-trigger-content';
import { USER_MENU_TRIGGER_CLASS } from './user-menu-styles';

export type UserMenuAction = {
  id: string;
  /** Ya traducido por el container. */
  label: string;
  onSelect: () => void;
  /** Ícono decorativo a la izquierda del texto. */
  icon?: ReactNode;
  /** Acción en curso: se deshabilita y se anuncia con `aria-busy` para evitar un doble disparo. */
  pending?: boolean;
};

export type UserMenuProps = {
  /** Nombre de la persona: es el nombre accesible del botón y el encabezado del menú. */
  name: string;
  /** Detalle bajo el nombre dentro del menú (normalmente el chip de rango ya traducido). */
  details?: ReactNode;
  actions: readonly UserMenuAction[];
};

// Carga diferida por la misma razón que `RowActionsMenu`: Radix Dropdown trae Popper y no debe
// viajar en el JS inicial de la barra superior.
const Impl = lazy(() =>
  import('./user-menu-impl').then((module) => ({ default: module.UserMenuImpl })),
);

/**
 * Menú de la persona en la barra superior (docs/frontend.md §4.1) sobre Radix: muestra nombre,
 * rango y sus acciones (cerrar sesión). Enter/Espacio/↓ lo abren, Escape lo cierra y devuelve el
 * foco al botón. No decide qué acciones existen ni autoriza: recibe la lista ya filtrada.
 * Mientras se descarga se ve el mismo botón, deshabilitado, para que la barra no salte.
 */
export function UserMenu(props: UserMenuProps) {
  return (
    <Suspense
      fallback={
        <button type="button" disabled aria-busy="true" className={USER_MENU_TRIGGER_CLASS}>
          <UserMenuTriggerContent name={props.name} />
        </button>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}
