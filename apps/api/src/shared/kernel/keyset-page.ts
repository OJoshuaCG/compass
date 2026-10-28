/** Tamaño y posición de una página de un listado de orden fijo. */
export interface KeysetRequest {
  readonly limit: number;
  /** Cursor opaco que devolvió la página anterior; `null` pide la primera. */
  readonly cursor: string | null;
}

export interface KeysetPage<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
}

/** Valida una parte del cursor ya decodificada, antes de que llegue a una consulta SQL. */
export type CursorPartValidator = (part: string) => boolean;

const MAX_CURSOR_PART_LENGTH = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Formato de `timestamptz::text` en PostgreSQL, con microsegundos y desfase de zona.
const TIMESTAMP_TEXT_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

// PostgreSQL rechaza el carácter NUL en texto y un control no tiene lugar en un nombre.
const hasControlCharacter = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

export const isUuidPart: CursorPartValidator = (part) => UUID_PATTERN.test(part);

export const isTimestampTextPart: CursorPartValidator = (part) => TIMESTAMP_TEXT_PATTERN.test(part);

export const isBitPart: CursorPartValidator = (part) => part === '0' || part === '1';

export const isPlainTextPart: CursorPartValidator = (part) =>
  part.length <= MAX_CURSOR_PART_LENGTH && !hasControlCharacter(part);

/**
 * Cursor opaco: las partes de la clave de orden de la última fila, en base64url. Solo mueve la
 * ventana, no da acceso a nada: el alcance (persona, organización) lo fija la consulta.
 */
export function encodeKeysetCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

/**
 * Devuelve las partes del cursor o `null` si es ilegible, tiene otra forma o alguna parte no pasa
 * su validador. Un cursor manipulado nunca llega a la base de datos: quien llama devuelve la
 * primera página en lugar de un error.
 */
export function decodeKeysetCursor(
  cursor: string | null,
  validators: readonly CursorPartValidator[],
): readonly string[] | null {
  if (cursor === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== validators.length) return null;
    const parts: string[] = [];
    for (const [index, validator] of validators.entries()) {
      const part: unknown = (parsed as unknown[])[index];
      if (typeof part !== 'string' || !validator(part)) return null;
      parts.push(part);
    }
    return parts;
  } catch {
    return null;
  }
}

/**
 * Recibe las filas de una consulta que pidió `limit + 1`: si sobra una, hay página siguiente y el
 * cursor sale de la última fila que sí se entrega.
 */
export function toKeysetPage<T>(
  rows: readonly T[],
  limit: number,
  cursorPartsOf: (row: T) => readonly string[],
): KeysetPage<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: hasMore && last !== undefined ? encodeKeysetCursor(cursorPartsOf(last)) : null,
  };
}
