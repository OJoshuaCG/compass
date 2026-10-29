import { z } from 'zod';

/** Tope de filas de datos por archivo (sin contar la cabecera ni las filas vacías). */
export const CREDENTIAL_IMPORT_MAX_ROWS = 500;

/** Tope del archivo en bytes (1 MB decimal). El archivo viaja en el cuerpo y solo vive en memoria. */
export const CREDENTIAL_IMPORT_MAX_BYTES = 1_000_000;

/** Columnas obligatorias, en el nombre exacto de la cabecera (sin importar mayúsculas ni el orden). */
export const CREDENTIAL_IMPORT_REQUIRED_COLUMNS = [
  'platform',
  'account_name',
  'credential_label',
  'username',
  'password',
] as const;

/**
 * Columnas opcionales que se aceptan en la cabecera. Hoy NO se guardan: la bóveda aún no tiene dónde
 * ponerlas (ver `odd/tasks/phase-1b-vault.md`, O2a); se validan y se ignoran sin devolverlas.
 */
export const CREDENTIAL_IMPORT_OPTIONAL_COLUMNS = ['url', 'notes'] as const;

/** Códigos estables de error por fila. La interfaz los traduce; nunca llevan el valor recibido. */
export const CREDENTIAL_IMPORT_ROW_ERROR_CODES = [
  'COLUMN_COUNT_MISMATCH',
  'PLATFORM_REQUIRED',
  'PLATFORM_UNKNOWN',
  'PLATFORM_AMBIGUOUS',
  'ACCOUNT_NAME_REQUIRED',
  'ACCOUNT_NAME_INVALID',
  'CREDENTIAL_LABEL_REQUIRED',
  'CREDENTIAL_LABEL_INVALID',
  'USERNAME_REQUIRED',
  'USERNAME_INVALID',
  'PASSWORD_REQUIRED',
  'PASSWORD_INVALID',
] as const;
export const credentialImportRowErrorCodeSchema = z.enum(CREDENTIAL_IMPORT_ROW_ERROR_CODES);
export type CredentialImportRowErrorCode = z.infer<typeof credentialImportRowErrorCodeSchema>;

export const CREDENTIAL_IMPORT_ROW_STATUSES = ['valid', 'invalid', 'duplicate'] as const;
export const credentialImportRowStatusSchema = z.enum(CREDENTIAL_IMPORT_ROW_STATUSES);
export type CredentialImportRowStatus = z.infer<typeof credentialImportRowStatusSchema>;

/** `in_file`: repetida en el mismo archivo; `existing`: la cuenta ya existe y la persona la ve. */
export const CREDENTIAL_IMPORT_DUPLICATE_REASONS = ['in_file', 'existing'] as const;
export const credentialImportDuplicateReasonSchema = z.enum(CREDENTIAL_IMPORT_DUPLICATE_REASONS);
export type CredentialImportDuplicateReason = z.infer<typeof credentialImportDuplicateReasonSchema>;

/**
 * El archivo viaja como texto en un solo campo. Solo se acota el largo aquí: el caso de uso comprueba los
 * bytes reales (UTF-8) y la estructura, para que un archivo rechazado deje el rastro que corresponda.
 * Nunca se recorta ni se normaliza: una contraseña puede llevar espacios en los extremos.
 */
export const importCredentialsRequestSchema = z.object({
  csv: z.string().min(1).max(CREDENTIAL_IMPORT_MAX_BYTES),
});
export type ImportCredentialsRequest = z.infer<typeof importCredentialsRequestSchema>;

/**
 * Una fila de la previsualización. Devuelve solo lo que ya vive en claro en la bóveda (plataforma, nombre
 * visible y etiqueta); NUNCA el usuario ni la contraseña de la plataforma.
 */
export const credentialImportRowSchema = z.object({
  /** Número de línea del archivo (la cabecera es la 1), para que la persona ubique el error. */
  line: z.number().int().positive(),
  status: credentialImportRowStatusSchema,
  errorCodes: z.array(credentialImportRowErrorCodeSchema),
  duplicateReason: credentialImportDuplicateReasonSchema.nullable(),
  platform: z.string(),
  accountName: z.string(),
  credentialLabel: z.string(),
});
export type CredentialImportRow = z.infer<typeof credentialImportRowSchema>;

export const credentialImportPreviewSchema = z.object({
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  rows: z.array(credentialImportRowSchema),
});
export type CredentialImportPreview = z.infer<typeof credentialImportPreviewSchema>;

/** Resultado de confirmar: solo conteos. */
export const credentialImportResultSchema = z.object({
  accountsCreated: z.number().int().nonnegative(),
  credentialsCreated: z.number().int().nonnegative(),
  duplicatesSkipped: z.number().int().nonnegative(),
});
export type CredentialImportResult = z.infer<typeof credentialImportResultSchema>;
