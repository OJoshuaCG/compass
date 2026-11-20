export type SigningKeyCommandErrorCode = 'USAGE' | 'SIGNING_KEY_NOT_FOUND';

/**
 * Error de la consola de claves de firma. Es local al comando (no es un `ErrorCode` de la API
 * HTTP), así que su mensaje se imprime tal cual y nunca incluye material de claves.
 */
export class SigningKeyCommandError extends Error {
  constructor(
    readonly code: SigningKeyCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SigningKeyCommandError';
  }
}
