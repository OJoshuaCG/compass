import { resolveLocale, isLocale, type Locale } from '@iam/i18n';

/** Preferencia no sensible: sí puede vivir en localStorage (docs/frontend.md §9). */
export const LOCALE_STORAGE_KEY = 'iam.locale';

export function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    // Modo privado o almacenamiento bloqueado: se sigue sin persistir.
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Mejor esfuerzo: la preferencia solo dura la sesión.
  }
}

/**
 * La detección del navegador ocurre solo en el primer acceso (docs/frontend.md §10):
 * una vez guardada una preferencia, manda esa, aunque cambie el idioma del navegador.
 * Cuando exista el perfil del usuario, su idioma reemplazará a este almacenamiento.
 */
export function detectInitialLocale(
  browserLanguage: string | undefined = window.navigator.language,
): Locale {
  const stored = readStoredLocale();
  if (stored !== null) return stored;
  const detected = resolveLocale(browserLanguage);
  storeLocale(detected);
  return detected;
}
