import { ErrorCode } from '@iam/contracts';

/**
 * Estado HTTP de cada código del catálogo. El tipo exige una entrada por código: agregar un código
 * nuevo al catálogo sin decidir su estado deja de compilar (antes caía en silencio en 500).
 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
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
  [ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED]: 403,
  [ErrorCode.PASSWORD_REUSED]: 422,
  [ErrorCode.USER_ROOT_PROTECTED]: 403,
  [ErrorCode.USER_INVALID_STATE]: 409,
  [ErrorCode.USER_HAS_REPORTS]: 409,
  [ErrorCode.USER_MANAGER_RANK_INVALID]: 422,
  [ErrorCode.PASSWORD_WEAK]: 422,
  [ErrorCode.INVITATION_INVALID]: 404,
  [ErrorCode.INVITATION_CONFLICT]: 409,
  [ErrorCode.ROLE_NAME_TAKEN]: 409,
  [ErrorCode.ROLE_SYSTEM_PROTECTED]: 403,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 422,
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: 422,
  [ErrorCode.IDEMPOTENCY_IN_PROGRESS]: 409,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.CONFLICT_VERSION]: 409,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL]: 500,
  [ErrorCode.CRYPTO_DECRYPT_FAILED]: 500,
  [ErrorCode.CRYPTO_KMS_UNAVAILABLE]: 503,
  [ErrorCode.CRYPTO_UNKNOWN_DEK_VERSION]: 500,
  [ErrorCode.AUDIT_METADATA_FIELD_NOT_ALLOWED]: 500,
  [ErrorCode.AUDIT_CHAIN_BROKEN]: 500,
  [ErrorCode.AUDIT_REASON_CODE_REQUIRED]: 500,
};

export const statusFor = (code: ErrorCode): number => STATUS_BY_CODE[code];

/**
 * Código que se muestra al cliente. Los 5xx internos (salvo la caída del KMS, que la UI sabe
 * explicar) se ocultan tras `INTERNAL` y el aislamiento entre organizaciones se oculta tras `NOT_FOUND`.
 */
export function externalCode(code: ErrorCode, status: number): ErrorCode {
  if (code === ErrorCode.AUTHZ_TENANT) return ErrorCode.NOT_FOUND;
  if (status >= 500 && code !== ErrorCode.CRYPTO_KMS_UNAVAILABLE) return ErrorCode.INTERNAL;
  return code;
}
