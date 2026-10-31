/**
 * Saneo del nombre visible de una persona antes de ponerlo en un correo (compartido por los avisos de
 * seguridad: tope de revelaciones y segundo factor sin confirmar).
 *
 * El nombre es un dato del directorio que escribe otra persona: un nombre hostil no debe poder partir el
 * correo en varias líneas, ocultar texto ni invertir su sentido visual.
 */

/** Largo máximo del nombre visible en el correo: acota el espacio que un nombre hostil puede ocupar. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Caracteres de control Unicode (`Cc`: saltos de línea, tabuladores, NUL...). Se sustituyen por un espacio
 * para que dos palabras separadas por un salto no se peguen.
 */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/**
 * Caracteres de formato Unicode (`Cf`), que incluyen los invisibles y bidireccionales (U+200B–200F,
 * U+202A–202E, U+2066–2069). Se eliminan sin dejar espacio: no se ven y, en un correo de seguridad, permitirían
 * invertir el sentido visual del nombre u ocultar texto.
 */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/** Deja el nombre en una sola línea visible: sin control ni bidi, espacios colapsados y largo acotado. */
export function sanitizeDisplayName(rawName: string): string {
  const withoutControl = rawName.replace(CONTROL_CHARACTERS, ' ');
  const withoutFormat = withoutControl.replace(FORMAT_CHARACTERS, '');
  const collapsed = withoutFormat.replace(/\s+/g, ' ').trim();
  // `Array.from` cuenta puntos de código, no unidades UTF-16: no parte un emoji por la mitad.
  return Array.from(collapsed).slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
}

/** Escapa los caracteres con significado en HTML; el texto de los correos se compone con datos ajenos. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);
}
