import { DomainError } from '../../../shared/kernel/index.js';

/** Mensajes genéricos a propósito: no revelan por qué falló el descifrado. */
export const decryptFailed = (): DomainError =>
  new DomainError('CRYPTO.DECRYPT_FAILED', 'Secret could not be decrypted');

export const kmsUnavailable = (): DomainError =>
  new DomainError('CRYPTO.KMS_UNAVAILABLE', 'Key management service is unavailable');

export const unknownDekVersion = (version: number): DomainError =>
  new DomainError('CRYPTO.UNKNOWN_DEK_VERSION', 'Unknown data key version', { version });
