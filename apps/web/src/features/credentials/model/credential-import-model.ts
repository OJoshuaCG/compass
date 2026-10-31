import {
  CREDENTIAL_IMPORT_MAX_BYTES,
  credentialImportRowErrorCodeSchema,
  type CredentialImportPreview,
  type CredentialImportRowErrorCode,
} from '@iam/contracts';

/** Extensión que se acepta en el cliente; el servidor valida el contenido de todos modos. */
export const CREDENTIAL_IMPORT_FILE_EXTENSION = '.csv';

export type CsvFileProblem = 'not_csv' | 'empty' | 'too_large';

/**
 * Revisa nombre y tamaño ANTES de leer el archivo: un archivo enorme ni siquiera se carga en
 * memoria. Solo se mira `name` y `size`, nunca el contenido.
 */
export function checkCsvFile(file: { name: string; size: number }): CsvFileProblem | null {
  if (!file.name.toLowerCase().endsWith(CREDENTIAL_IMPORT_FILE_EXTENSION)) return 'not_csv';
  if (file.size === 0) return 'empty';
  if (file.size > CREDENTIAL_IMPORT_MAX_BYTES) return 'too_large';
  return null;
}

/**
 * Confirmar solo tiene sentido sin filas inválidas (la confirmación es todo o nada) y con algo que
 * crear: un archivo de puros duplicados no escribiría nada.
 */
export function canConfirmImport(preview: CredentialImportPreview): boolean {
  return preview.invalidRows === 0 && preview.validRows > 0;
}

export type RowErrorLine = { line: number; code: CredentialImportRowErrorCode };

const LINE_FIELD_PATTERN = /^line\.(\d+)$/;

/**
 * Extrae del 422 de la confirmación las filas rechazadas (`errors[{ field: 'line.N', code }]`).
 * Ignora lo que no tenga esa forma o un código que el contrato no conozca: la interfaz nunca
 * muestra texto del servidor sin traducir.
 */
export function parseRowErrorLines(
  fieldErrors: readonly { field: string; code: string }[],
): RowErrorLine[] {
  const lines: RowErrorLine[] = [];
  for (const fieldError of fieldErrors) {
    const match = LINE_FIELD_PATTERN.exec(fieldError.field);
    const code = credentialImportRowErrorCodeSchema.safeParse(fieldError.code);
    if (match?.[1] === undefined || !code.success) continue;
    lines.push({ line: Number(match[1]), code: code.data });
  }
  return lines;
}

/** Filas de la página `offset..offset+limit`: la tabla estándar nunca pinta más de 100 filas. */
export function sliceRows<T>(rows: readonly T[], offset: number, limit: number): T[] {
  return rows.slice(offset, offset + limit);
}
