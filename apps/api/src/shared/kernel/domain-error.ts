import type { ErrorCode } from '@iam/contracts';

/**
 * Error esperado del dominio. `code` es estable (clave de traducción en la UI) y `meta`
 * solo admite valores primitivos seguros: nunca secretos ni datos internos.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly meta: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: ErrorCode,
    message: string,
    meta: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DomainError';
    this.code = code;
    this.meta = meta;
  }
}
