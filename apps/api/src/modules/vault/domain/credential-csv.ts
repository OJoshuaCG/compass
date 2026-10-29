/**
 * Lectura y validación estructural del CSV de importación de credenciales.
 *
 * Invariantes de seguridad
 * - Todo ocurre en memoria: el texto entra como cadena y nada de él se escribe, se registra ni viaja en un
 *   error. Los errores llevan solo códigos estables y números de línea, nunca el valor de una celda.
 * - Aquí no hay acceso a datos ni cifrado: resolver la plataforma, detectar duplicados contra la bóveda y
 *   guardar es trabajo del caso de uso.
 */
import {
  CREDENTIAL_IMPORT_MAX_BYTES,
  CREDENTIAL_IMPORT_MAX_ROWS,
  CREDENTIAL_IMPORT_OPTIONAL_COLUMNS,
  CREDENTIAL_IMPORT_REQUIRED_COLUMNS,
  hasControlCharacter,
} from '@iam/contracts';
import type { CredentialImportRowErrorCode } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Result } from '../../../shared/kernel/index.js';

/** Mismos largos que al crear una cuenta y una credencial a mano (`createAccountRequestSchema`, etc.). */
const ACCOUNT_NAME_MAX_LENGTH = 200;
const CREDENTIAL_LABEL_MAX_LENGTH = 200;
const USERNAME_MAX_LENGTH = 256;
const PASSWORD_MAX_LENGTH = 1024;

const BYTE_ORDER_MARK = '﻿';
const DELIMITER = ',';
const QUOTE = '"';

type RequiredColumn = (typeof CREDENTIAL_IMPORT_REQUIRED_COLUMNS)[number];
type OptionalColumn = (typeof CREDENTIAL_IMPORT_OPTIONAL_COLUMNS)[number];
type KnownColumn = RequiredColumn | OptionalColumn;

const KNOWN_COLUMNS: readonly string[] = [
  ...CREDENTIAL_IMPORT_REQUIRED_COLUMNS,
  ...CREDENTIAL_IMPORT_OPTIONAL_COLUMNS,
];

/** Una fila cruda del CSV con el número de línea donde empieza (la primera línea del archivo es la 1). */
export interface RawCsvRow {
  readonly line: number;
  readonly cells: readonly string[];
}

/** Una fila de datos ya ubicada por columna; los valores aún no se validaron. */
export interface ImportRow {
  readonly line: number;
  /** `false` si la fila trae más o menos celdas que la cabecera. */
  readonly shapeOk: boolean;
  readonly platform: string;
  readonly accountName: string;
  readonly credentialLabel: string;
  readonly username: string;
  readonly password: string;
}

const fileError = (code: DomainError['code'], message: string): DomainError =>
  new DomainError(code, message);

const isBlankRow = (cells: readonly string[]): boolean => cells.every((cell) => cell.trim() === '');

/**
 * CSV según RFC 4180: campos entre comillas (con `""` como comilla literal y saltos de línea dentro),
 * saltos `\r\n`, `\n` o `\r`, y BOM inicial. Las filas totalmente vacías se descartan.
 * Una comilla abierta sin cerrar invalida todo el archivo.
 */
export function parseCsv(text: string): Result<readonly RawCsvRow[], DomainError> {
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;

  const rows: RawCsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let currentLine = 1;
  let rowStartLine = 1;

  const endField = (): void => {
    cells.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = (): void => {
    endField();
    if (!isBlankRow(cells)) rows.push({ line: rowStartLine, cells });
    cells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);

    if (inQuotes) {
      if (char === QUOTE) {
        if (source.charAt(index + 1) === QUOTE) {
          field += QUOTE;
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') currentLine += 1;
        else if (char === '\r' && source.charAt(index + 1) !== '\n') currentLine += 1;
        field += char;
      }
      continue;
    }

    if (char === QUOTE && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === DELIMITER) {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source.charAt(index + 1) === '\n') index += 1;
      endRow();
      currentLine += 1;
      rowStartLine = currentLine;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    return err(fileError('CREDENTIAL_IMPORT.MALFORMED', 'CSV has an unterminated quoted field'));
  }
  // Última fila sin salto de línea final.
  if (field !== '' || cells.length > 0 || fieldWasQuoted) endRow();

  return ok(rows);
}

/**
 * Lee el archivo completo: tamaño, cabecera y filas. Devuelve las filas ubicadas por columna.
 * Los errores de todo el archivo se devuelven como `DomainError`; los de cada fila los decide
 * `validateImportRow`, para poder señalar todas a la vez en la previsualización.
 */
export function readImportFile(csv: string): Result<readonly ImportRow[], DomainError> {
  if (new TextEncoder().encode(csv).length > CREDENTIAL_IMPORT_MAX_BYTES) {
    return err(fileError('CREDENTIAL_IMPORT.FILE_TOO_LARGE', 'CSV file is too large'));
  }
  const parsed = parseCsv(csv);
  if (!parsed.ok) return parsed;

  const [headerRow, ...dataRows] = parsed.value;
  if (headerRow === undefined) {
    return err(fileError('CREDENTIAL_IMPORT.EMPTY', 'CSV file has no content'));
  }
  const header = readHeader(headerRow.cells);
  if (!header.ok) return header;

  if (dataRows.length === 0) {
    return err(fileError('CREDENTIAL_IMPORT.EMPTY', 'CSV file has no data rows'));
  }
  if (dataRows.length > CREDENTIAL_IMPORT_MAX_ROWS) {
    return err(fileError('CREDENTIAL_IMPORT.TOO_MANY_ROWS', 'CSV file has too many rows'));
  }

  const columnIndex = header.value;
  const cellOf = (row: RawCsvRow, column: KnownColumn): string => {
    const position = columnIndex.get(column);
    return position === undefined ? '' : (row.cells[position] ?? '');
  };
  return ok(
    dataRows.map((row) => ({
      line: row.line,
      shapeOk: row.cells.length === columnIndex.size,
      platform: cellOf(row, 'platform').trim(),
      accountName: cellOf(row, 'account_name').trim(),
      credentialLabel: cellOf(row, 'credential_label').trim(),
      username: cellOf(row, 'username').trim(),
      // La contraseña se conserva tal cual: los espacios en los extremos pueden ser parte de ella.
      password: cellOf(row, 'password'),
    })),
  );
}

/** Cabecera: nombres sin importar mayúsculas ni espacios, sin repetidos ni columnas desconocidas. */
function readHeader(cells: readonly string[]): Result<Map<KnownColumn, number>, DomainError> {
  const invalid = (): Result<Map<KnownColumn, number>, DomainError> =>
    err(fileError('CREDENTIAL_IMPORT.HEADER_INVALID', 'CSV header is not valid'));

  const positions = new Map<KnownColumn, number>();
  for (const [position, rawName] of cells.entries()) {
    const name = rawName.trim().toLowerCase();
    if (!KNOWN_COLUMNS.includes(name)) return invalid();
    const column = name as KnownColumn;
    if (positions.has(column)) return invalid();
    positions.set(column, position);
  }
  for (const required of CREDENTIAL_IMPORT_REQUIRED_COLUMNS) {
    if (!positions.has(required)) return invalid();
  }
  return ok(positions);
}

/**
 * Errores propios de la fila, sin consultar nada. La plataforma se resuelve después contra el catálogo.
 * Un valor vacío es "obligatorio"; uno con caracteres de control o demasiado largo es "inválido".
 */
export function validateImportRow(row: ImportRow): CredentialImportRowErrorCode[] {
  const errors: CredentialImportRowErrorCode[] = [];
  if (!row.shapeOk) {
    errors.push('COLUMN_COUNT_MISMATCH');
    return errors;
  }
  if (row.platform === '') errors.push('PLATFORM_REQUIRED');

  const checkText = (
    value: string,
    maxLength: number,
    required: CredentialImportRowErrorCode,
    invalid: CredentialImportRowErrorCode,
  ): void => {
    if (value === '') errors.push(required);
    else if (value.length > maxLength || hasControlCharacter(value)) errors.push(invalid);
  };
  checkText(
    row.accountName,
    ACCOUNT_NAME_MAX_LENGTH,
    'ACCOUNT_NAME_REQUIRED',
    'ACCOUNT_NAME_INVALID',
  );
  checkText(
    row.credentialLabel,
    CREDENTIAL_LABEL_MAX_LENGTH,
    'CREDENTIAL_LABEL_REQUIRED',
    'CREDENTIAL_LABEL_INVALID',
  );
  checkText(row.username, USERNAME_MAX_LENGTH, 'USERNAME_REQUIRED', 'USERNAME_INVALID');

  if (row.password === '') errors.push('PASSWORD_REQUIRED');
  else if (row.password.length > PASSWORD_MAX_LENGTH) errors.push('PASSWORD_INVALID');
  return errors;
}
