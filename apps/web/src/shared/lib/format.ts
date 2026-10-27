/**
 * Fechas con `Intl` en el idioma y la zona horaria del usuario (docs/frontend.md §10): nadie
 * llama a `toLocaleString` directamente. Si la zona del perfil no es válida, se usa la del
 * navegador en lugar de romper la pantalla.
 *
 * Crear un `Intl.DateTimeFormat` es caro (consulta de datos de localización): se reutiliza uno por
 * combinación de idioma y zona, porque una tabla con fechas lo pediría en cada celda y cada render.
 */
const OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string, timeZone: string | undefined): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone ?? ''}`;
  const cached = formatters.get(key);
  if (cached !== undefined) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat(locale, {
      ...OPTIONS,
      ...(timeZone !== undefined ? { timeZone } : {}),
    });
  } catch {
    created = new Intl.DateTimeFormat(locale, OPTIONS);
  }
  formatters.set(key, created);
  return created;
}

export function formatDateTime(iso: string, locale: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatterFor(locale, timeZone).format(date);
}
