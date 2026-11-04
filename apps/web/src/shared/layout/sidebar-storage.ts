/** Prefijo de la clave del menú lateral; el identificador de la persona se agrega al final. */
export const SIDEBAR_STORAGE_KEY_PREFIX = 'iam.sidebar';

const HIDDEN_VALUE = 'hidden';
const VISIBLE_VALUE = 'visible';

/**
 * Cada persona recuerda su propia elección aunque comparta navegador. El identificador es un UUID
 * interno, no un dato personal.
 */
export function sidebarStorageKey(personId: string | undefined): string {
  return personId === undefined
    ? SIDEBAR_STORAGE_KEY_PREFIX
    : `${SIDEBAR_STORAGE_KEY_PREFIX}.${personId}`;
}

/** `null` = la persona nunca ha elegido (o el almacenamiento no está disponible). */
export function readStoredSidebarVisible(personId: string | undefined): boolean | null {
  try {
    const storedValue: string | null = window.localStorage.getItem(sidebarStorageKey(personId));
    if (storedValue === VISIBLE_VALUE) return true;
    if (storedValue === HIDDEN_VALUE) return false;
    return null;
  } catch {
    // Modo privado o almacenamiento bloqueado: se sigue sin persistir.
    return null;
  }
}

/** Preferencia no sensible: sí puede vivir en localStorage (docs/frontend.md §9). */
export function storeSidebarVisible(personId: string | undefined, visible: boolean): void {
  try {
    window.localStorage.setItem(
      sidebarStorageKey(personId),
      visible ? VISIBLE_VALUE : HIDDEN_VALUE,
    );
  } catch {
    // Mejor esfuerzo: la preferencia solo dura la sesión.
  }
}
