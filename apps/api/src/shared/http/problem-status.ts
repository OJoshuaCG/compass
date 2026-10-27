import { ErrorCode } from '@iam/contracts';

/** Estado HTTP de cada código del catálogo. Un código sin entrada responde 500. */
const STATUS_BY_CODE: Readonly<Partial<Record<ErrorCode, number>>> = {
  [ErrorCode.AUTHZ_SESSION]: 401,
  // El recurso de otra organización se responde como inexistente (404): no se revela que existe.
  [ErrorCode.AUTHZ_TENANT]: 404,
  [ErrorCode.AUTHZ_PERMISSION]: 403,
  [ErrorCode.AUTHZ_HIERARCHY_NOT_IN_SUBTREE]: 403,
  [ErrorCode.AUTHZ_SHARE]: 403,
  [ErrorCode.AUTHZ_REAUTH_REQUIRED]: 403,
  [ErrorCode.AUTHZ_CREATION_NOT_ALLOWED]: 403,
  [ErrorCode.AUTHZ_ROLE_ESCALATION]: 403,
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 401,
  [ErrorCode.AUTH_MFA_INVALID]: 401,
  [ErrorCode.AUTH_MFA_REQUIRED]: 403,
  [ErrorCode.AUTH_ENROLLMENT_REQUIRED]: 403,
  [ErrorCode.PASSWORD_WEAK]: 422,
  [ErrorCode.INVITATION_INVALID]: 404,
  [ErrorCode.INVITATION_CONFLICT]: 409,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.CONFLICT_VERSION]: 409,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.CRYPTO_KMS_UNAVAILABLE]: 503,
};

export const statusFor = (code: ErrorCode): number => STATUS_BY_CODE[code] ?? 500;

/**
 * Código que se muestra al cliente. Los 5xx internos (salvo la caída del KMS, que la UI sabe
 * explicar) se ocultan tras `INTERNAL` y el aislamiento entre organizaciones se oculta tras `NOT_FOUND`.
 */
export function externalCode(code: ErrorCode, status: number): ErrorCode {
  if (code === ErrorCode.AUTHZ_TENANT) return ErrorCode.NOT_FOUND;
  if (status >= 500 && code !== ErrorCode.CRYPTO_KMS_UNAVAILABLE) return ErrorCode.INTERNAL;
  return code;
}
