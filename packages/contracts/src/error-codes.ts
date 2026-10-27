/**
 * Catálogo versionado de códigos de error estables.
 * El `code` es la clave de traducción en la UI y viaja en Problem Details (RFC 9457).
 * Agregar un código exige agregar su traducción en `@iam/i18n` (namespace `errors`).
 */
export const ErrorCode = {
  // Decisiones del motor de autorización (plan: "Motor de decisión").
  AUTHZ_TENANT: 'AUTHZ.TENANT',
  AUTHZ_SESSION: 'AUTHZ.SESSION',
  AUTHZ_PERMISSION: 'AUTHZ.PERMISSION',
  AUTHZ_HIERARCHY_NOT_IN_SUBTREE: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
  AUTHZ_SHARE: 'AUTHZ.SHARE',
  AUTHZ_REAUTH_REQUIRED: 'AUTHZ.REAUTH_REQUIRED',
  // Contrato HTTP.
  VALIDATION_FAILED: 'VALIDATION.FAILED',
  CONFLICT_VERSION: 'CONFLICT.VERSION',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  // Criptografía.
  CRYPTO_DECRYPT_FAILED: 'CRYPTO.DECRYPT_FAILED',
  CRYPTO_KMS_UNAVAILABLE: 'CRYPTO.KMS_UNAVAILABLE',
  CRYPTO_UNKNOWN_DEK_VERSION: 'CRYPTO.UNKNOWN_DEK_VERSION',
  // Auditoría.
  AUDIT_METADATA_FIELD_NOT_ALLOWED: 'AUDIT.METADATA_FIELD_NOT_ALLOWED',
  AUDIT_CHAIN_BROKEN: 'AUDIT.CHAIN_BROKEN',
  AUDIT_REASON_CODE_REQUIRED: 'AUDIT.REASON_CODE_REQUIRED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);
