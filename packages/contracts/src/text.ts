/**
 * Caracteres de control (U+0000-U+001F y U+007F). PostgreSQL rechaza el NUL en texto con un error
 * de base de datos, y el resto no tiene cabida en nombres ni en búsquedas: se rechazan en el borde
 * (validación 422) en lugar de dejar que lleguen a una consulta.
 */
// eslint-disable-next-line no-control-regex -- detectar caracteres de control es justo el propósito
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

export const hasControlCharacter = (value: string): boolean => CONTROL_CHARACTER.test(value);
