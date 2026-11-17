import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import { integrationSecretContext } from '../domain/integration-secret-context.js';
import { SMTP_PASSWORD_FIELD } from '../domain/smtp-config.js';
import type { StoredSmtpPassword } from './ports/smtp-settings-store.js';

const textDecoder = new TextDecoder();

/**
 * Abre la contraseña guardada del servidor SMTP y borra el búfer en claro. Una contraseña que no se abre es
 * un fallo del servicio de llaves, no de la persona: se LANZA (devolver un error confirmaría la unidad de
 * trabajo y, al enviar, cambiaría el remitente en silencio).
 */
export async function openSmtpPassword(
  cipher: Pick<SecretCipher, 'decrypt'>,
  organizationId: OrganizationId,
  settingsId: string,
  stored: StoredSmtpPassword,
): Promise<string> {
  const opened = await cipher.decrypt(
    integrationSecretContext(organizationId, settingsId, SMTP_PASSWORD_FIELD, stored.secretVersion),
    stored.encrypted,
  );
  if (!opened.ok) throw opened.error;
  try {
    return textDecoder.decode(opened.value);
  } finally {
    opened.value.fill(0);
  }
}
