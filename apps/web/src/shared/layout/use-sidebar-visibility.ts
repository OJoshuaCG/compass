import { useState } from 'react';

import { readStoredSidebarVisible, storeSidebarVisible } from './sidebar-storage';

/** Punto de quiebre `md` de Tailwind (768 px): desde ahí el menú va al lado del contenido. */
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

/**
 * Sin elección guardada, el menú es visible en escritorio y queda plegado en pantallas estrechas,
 * donde apilado ocuparía toda la pantalla antes del contenido. Este valor por omisión NO se
 * persiste: solo se guarda lo que la persona decide con el botón.
 */
function defaultSidebarVisible(): boolean {
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** Sin `matchMedia` se asume escritorio: ahí el menú no estorba al contenido y no se cierra solo. */
function isNarrowScreen(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

export type SidebarVisibility = {
  visible: boolean;
  toggle: () => void;
  /**
   * Pliega el menú tras navegar en pantallas estrechas, donde apilado tapa el contenido. No guarda
   * la preferencia: es una comodidad del momento, no una decisión de la persona. En escritorio no hace nada.
   */
  close: () => void;
};

/** Estado del menú lateral con su preferencia por persona en `localStorage`. */
export function useSidebarVisibility(personId: string | undefined): SidebarVisibility {
  const [visible, setVisible] = useState<boolean>(() => {
    const storedVisible: boolean | null = readStoredSidebarVisible(personId);
    return storedVisible ?? defaultSidebarVisible();
  });
  return {
    visible,
    toggle: () => {
      const nextVisible: boolean = !visible;
      storeSidebarVisible(personId, nextVisible);
      setVisible(nextVisible);
    },
    close: () => {
      if (!isNarrowScreen()) return;
      setVisible(false);
    },
  };
}
