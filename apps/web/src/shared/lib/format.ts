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

const LONG_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/**
 * Fecha larga para encabezados ("Miércoles, 28 de octubre"). Se usa una vez por pantalla, así que
 * no se cachea. El español escribe el día en minúscula: se capitaliza por estar al inicio.
 */
export function formatLongDate(date: Date, locale: string, timeZone?: string): string {
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, {
      ...LONG_DATE,
      ...(timeZone !== undefined ? { timeZone } : {}),
    }).format(date);
  } catch {
    text = new Intl.DateTimeFormat(locale, LONG_DATE).format(date);
  }
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}
