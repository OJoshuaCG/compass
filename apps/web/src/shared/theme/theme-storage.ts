/** Los dos temas del sistema visual (docs/frontend.md §4.1, ADR 0044). */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'iam.theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Preferencia no sensible: sí puede vivir en localStorage (docs/frontend.md §9). */
export function readStoredTheme(): Theme | null {
  try {
    const storedValue: string | null = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(storedValue) ? storedValue : null;
  } catch {
    // Modo privado o almacenamiento bloqueado: se sigue sin persistir.
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Mejor esfuerzo: la preferencia solo dura la sesión.
  }
}
