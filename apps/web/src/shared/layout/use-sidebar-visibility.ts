import { useState, useSyncExternalStore } from 'react';

import { readStoredSidebarVisible, storeSidebarVisible } from './sidebar-storage';

/** Punto de quiebre `md` de Tailwind (768 px): desde ahí el menú va al lado del contenido. */
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

/** Sin `matchMedia` se asume escritorio: ahí el menú no estorba al contenido y no se cierra solo. */
function isNarrowScreen(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

/** Avisa cuando la pantalla cruza el punto de quiebre (por ejemplo, al girar el teléfono). */
function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mediaQueryList: MediaQueryList = window.matchMedia(DESKTOP_MEDIA_QUERY);
  if (typeof mediaQueryList.addEventListener !== 'function') return () => undefined;
  mediaQueryList.addEventListener('change', onChange);
  return () => {
    mediaQueryList.removeEventListener('change', onChange);
  };
}

export type SidebarVisibility = {
  visible: boolean;
  /** Pantalla estrecha: el menú es un panel modal y no una columna. */
  narrow: boolean;
  toggle: () => void;
  /** Cierra el panel en pantallas estrechas (tras navegar, Escape o toque en el fondo). En escritorio no hace nada. */
  close: () => void;
};

/**
 * Estado del menú lateral. En escritorio es una columna cuya visibilidad la persona decide y se
 * recuerda por persona en `localStorage`. En pantallas estrechas es un panel modal que siempre
 * arranca cerrado y NO se persiste: abrirlo es un gesto del momento, y recordarlo haría que la
 * siguiente visita desde el teléfono arrancara con el menú tapando la pantalla.
 */
export function useSidebarVisibility(personId: string | undefined): SidebarVisibility {
  const narrow: boolean = useSyncExternalStore(subscribeToViewport, isNarrowScreen, () => false);
  const [desktopVisible, setDesktopVisible] = useState<boolean>(
    () => readStoredSidebarVisible(personId) ?? true,
  );
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [previousNarrow, setPreviousNarrow] = useState<boolean>(narrow);
  // Al cruzar el punto de quiebre el panel vuelve a cerrarse: evita que reaparezca abierto al
  // regresar a una pantalla estrecha después de girar el teléfono.
  if (previousNarrow !== narrow) {
    setPreviousNarrow(narrow);
    setDrawerOpen(false);
  }
  return {
    visible: narrow ? drawerOpen : desktopVisible,
    narrow,
    toggle: () => {
      if (narrow) {
        setDrawerOpen(!drawerOpen);
        return;
      }
      const nextVisible: boolean = !desktopVisible;
      storeSidebarVisible(personId, nextVisible);
      setDesktopVisible(nextVisible);
    },
    close: () => {
      if (!narrow) return;
      setDrawerOpen(false);
    },
  };
}
