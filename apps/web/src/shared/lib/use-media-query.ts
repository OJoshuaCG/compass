import { useCallback, useSyncExternalStore } from 'react';

/** Punto de quiebre `md` de Tailwind (768 px): desde ahí la pantalla se trata como de escritorio. */
export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

/**
 * Si la consulta de medios se cumple ahora, y se actualiza al cambiar el tamaño de la ventana. Sirve
 * cuando ocultar con CSS no basta: dos versiones del mismo control (por ejemplo, botones de escritorio
 * y menú móvil) duplicarían los nombres accesibles. Sin `matchMedia` (pruebas) devuelve `fallback`.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  const read = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback;
  return useSyncExternalStore(subscribe, read, () => fallback);
}
