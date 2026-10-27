import type { Logger } from 'pino';

import type { InvitationMessage, Mailer } from '../application/ports/mailer.js';

/**
 * Adaptador de desarrollo: escribe el enlace de la invitación en el log. En producción se sustituye
 * por SES; por eso se niega a arrancar con NODE_ENV=production (el token es un secreto).
 */
export class LogMailer implements Mailer {
  constructor(
    private readonly logger: Logger,
    private readonly baseUrl: string,
    nodeEnv: string | undefined,
  ) {
    if (nodeEnv === 'production') {
      throw new Error('LogMailer refuses to start when NODE_ENV=production');
    }
  }

  sendInvitation(message: InvitationMessage): Promise<void> {
    const link = `${this.baseUrl}/invitation#token=${encodeURIComponent(message.token)}`;
    this.logger.info(
      { to: message.to, expiresAt: message.expiresAt, link },
      'invitation email (dev)',
    );
    return Promise.resolve();
  }
}
