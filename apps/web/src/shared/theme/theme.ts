import { isTheme, readStoredTheme, type Theme } from './theme-storage';

const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

/**
 * Sin preferencia guardada se sigue la del sistema operativo. No se guarda esa detección:
 * así, mientras la persona no elija, un cambio del sistema se refleja en el siguiente acceso.
 */
export function detectInitialTheme(
  systemPrefersLight: boolean = window.matchMedia(LIGHT_SCHEME_QUERY).matches,
): Theme {
  const storedTheme: Theme | null = readStoredTheme();
  if (storedTheme !== null) return storedTheme;
  return systemPrefersLight ? 'light' : 'dark';
}

/** Fija el tema en el elemento raíz; los tokens de `@iam/ui` reaccionan a `data-theme`. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
}

/** Tema que está pintado ahora; oscuro si el arranque aún no lo fijó (valor por defecto de los tokens). */
export function readAppliedTheme(root: HTMLElement = document.documentElement): Theme {
  const appliedTheme: string | null = root.getAttribute('data-theme');
  return isTheme(appliedTheme) ? appliedTheme : 'dark';
}
