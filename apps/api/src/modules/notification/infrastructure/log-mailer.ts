import type { Logger } from 'pino';

import type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
  RevealLimitAlertMessage,
  SecurityNoticeMessage,
} from '../application/ports/mailer.js';

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

  sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void> {
    this.logger.warn({ to: message.to, usedAt: message.usedAt }, 'emergency code used (dev)');
    return Promise.resolve();
  }

  sendRevealLimitAlert(message: RevealLimitAlertMessage): Promise<void> {
    // Sin destinatario ni nombre de la persona: son datos personales y aquí solo importan los conteos.
    this.logger.warn(
      {
        limitPerHour: message.limitPerHour,
        revealedInWindow: message.revealedInWindow,
        occurredAt: message.occurredAt,
      },
      'reveal limit alert (dev)',
    );
    return Promise.resolve();
  }

  sendSecurityNotice(message: SecurityNoticeMessage): Promise<void> {
    // Sin el destinatario: el correo es un dato personal y aquí solo importa qué aviso salió.
    this.logger.info(
      { kind: message.kind, occurredAt: message.occurredAt },
      'security notice (dev)',
    );
    return Promise.resolve();
  }
}
