/**
 * Fechas con `Intl` en el idioma y la zona horaria del usuario (docs/frontend.md §10): nadie
 * llama a `toLocaleString` directamente. Si la zona del perfil no es válida, se usa la del
 * navegador en lugar de romper la pantalla.
 */
export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      ...(timeZone !== undefined ? { timeZone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}
