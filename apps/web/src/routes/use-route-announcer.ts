import { MAIN_CONTENT_ID } from '@iam/ui';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

const TITLE_SEPARATOR = ' · ';
const HEADING_SELECTOR = 'h1';
// Las pantallas cargan su código y sus datos de forma diferida: se espera su encabezado un
// tiempo acotado, y si no aparece el título queda con el nombre de la aplicación.
const HEADING_WAIT_MS = 3000;

/**
 * En una SPA el navegador no avisa que cambió la "página". Este hook hace lo que haría una carga
 * normal: el título del documento sigue al `h1` de la pantalla y, al navegar a otra ruta, el
 * foco pasa al contenedor principal y el nuevo título se escribe en una región `role="status"`
 * para que un lector de pantalla anuncie dónde está la persona (WCAG 2.4.2 y 2.4.3). Se observa
 * solo `pathname`: cambiar únicamente los parámetros de búsqueda (orden o paginación de una tabla)
 * ni mueve el foco ni anuncia. En la primera carga y al cambiar de idioma solo se actualiza el
 * título: no se mueve el foco de quien ya está operando.
 *
 * Se enfoca el `main` y no el `h1` porque el `h1` no es un destino de teclado: el siguiente Tab
 * parte del contenido de la pantalla nueva. La región se escribe por DOM directo para no
 * re-renderizar el árbol raíz en cada navegación.
 */
export function useRouteAnnouncer(statusRef: RefObject<HTMLElement | null>): void {
  const { t, i18n } = useTranslation('common');
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const previousPathname = useRef<string | null>(null);
  const language = i18n.language;

  useEffect(() => {
    const hasNavigated = previousPathname.current !== null && previousPathname.current !== pathname;
    previousPathname.current = pathname;
    const applicationName = t('app.name');

    // Al navegar, la pantalla anterior sigue montada mientras la nueva carga de forma diferida:
    // su h1 no debe tomarse como el de la ruta nueva.
    const staleHeading = hasNavigated
      ? document.querySelector<HTMLElement>(HEADING_SELECTOR)
      : null;
    const staleHeadingText = staleHeading?.textContent.trim();

    const announce = (acceptStaleHeading: boolean): boolean => {
      const heading = document.querySelector<HTMLElement>(HEADING_SELECTOR);
      if (heading === null) {
        return false;
      }
      const headingText = heading.textContent.trim();
      const isStillPreviousScreen = heading === staleHeading && headingText === staleHeadingText;
      if (isStillPreviousScreen && !acceptStaleHeading) {
        return false;
      }
      document.title =
        headingText.length > 0
          ? `${headingText}${TITLE_SEPARATOR}${applicationName}`
          : applicationName;
      if (hasNavigated) {
        // El `main` lleva tabindex -1: se puede enfocar por código sin entrar al orden del teclado.
        document.getElementById(MAIN_CONTENT_ID)?.focus();
        if (statusRef.current !== null) {
          statusRef.current.textContent = document.title;
        }
      }
      return true;
    };

    if (announce(false)) {
      return undefined;
    }

    if (staleHeading === null) {
      document.title = applicationName;
    }
    const observer = new MutationObserver(() => {
      if (announce(false)) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = window.setTimeout(() => {
      // Dos pantallas pueden compartir encabezado idéntico: pasado el plazo se anuncia el que haya.
      observer.disconnect();
      announce(true);
    }, HEADING_WAIT_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, [pathname, language, t, statusRef]);
}
