import type { SecretContext } from '../../crypto/index.js';
import type { UserId } from '../../../shared/kernel/index.js';

/**
 * Contexto de cifrado (y, por tanto, AAD) del secreto TOTP de una persona. Lo comparten el alta y
 * la verificación del segundo factor y el recifrado por rotación de DEK (ADR 0040): si divergieran,
 * el secreto recifrado dejaría de poder abrirse.
 */
export function totpSecretContext(
  organizationId: SecretContext['organizationId'],
  userId: UserId,
): SecretContext {
  return { organizationId, resourceId: userId, field: 'totp_secret', version: 1 };
}
