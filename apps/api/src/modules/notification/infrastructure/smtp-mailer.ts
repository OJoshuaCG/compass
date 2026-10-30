import { createTransport } from 'nodemailer';

import {
  renderEmergencyAlertEmail,
  renderInvitationEmail,
} from '../application/render-invitation-email.js';
import { renderPendingTotpEmail } from '../application/render-pending-totp-email.js';
import { renderRankChangeEmail } from '../application/render-rank-change-email.js';
import { renderRevealLimitEmail } from '../application/render-reveal-limit-email.js';
import { renderSecurityNoticeEmail } from '../application/render-security-notice-email.js';
import type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
  PendingTotpNoticeMessage,
  RankChangeNoticeMessage,
  RevealLimitAlertMessage,
  SecurityNoticeMessage,
} from '../application/ports/mailer.js';

export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  /**
   * `starttls`: conexión que sube a TLS y se niega a continuar sin él (puerto 587).
   * `tls`: TLS desde el inicio (puerto 465). `none`: sin cifrado, solo para pruebas locales.
   */
  readonly security: SmtpSecurity;
  readonly user: string | undefined;
  readonly password: string | undefined;
  /** Remitente, por ejemplo `IAM <no-reply@tudominio.com>`: debe pertenecer al dominio propio. */
  readonly from: string;
  /** Origen público de la aplicación, para construir el enlace de invitación. */
  readonly baseUrl: string;
}

/** Lo único que se usa del transporte; permite sustituirlo en pruebas. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/**
 * Correo saliente por SMTP del dominio propio.
 *
 * Invariantes de seguridad
 * - Nunca envía credenciales ni contenido sin cifrar salvo con `security: none` (rechazado en producción).
 * - Verifica el certificado del servidor (no se desactiva).
 * - Los errores del proveedor se reemplazan por uno genérico: pueden citar el destinatario o el
 *   contenido y el cuerpo lleva un token.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: MailTransport;

  constructor(
    private readonly options: SmtpOptions,
    nodeEnv: string | undefined,
    transport?: MailTransport,
  ) {
    if (nodeEnv === 'production' && options.security === 'none') {
      throw new Error('SmtpMailer refuses to run without TLS when NODE_ENV=production');
    }
    this.transport =
      transport ??
      createTransport({
        host: options.host,
        port: options.port,
        secure: options.security === 'tls',
        requireTLS: options.security === 'starttls',
        ignoreTLS: options.security === 'none',
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        ...(options.user === undefined || options.password === undefined
          ? {}
          : { auth: { user: options.user, pass: options.password } }),
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async sendInvitation(message: InvitationMessage): Promise<void> {
    const email = renderInvitationEmail(message, this.options.baseUrl);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }

  async sendSecurityNotice(message: SecurityNoticeMessage): Promise<void> {
    const email = renderSecurityNoticeEmail(message);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }

  async sendRevealLimitAlert(message: RevealLimitAlertMessage): Promise<void> {
    const email = renderRevealLimitEmail(message);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }

  async sendRankChangeNotice(message: RankChangeNoticeMessage): Promise<void> {
    const email = renderRankChangeEmail(message);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }

  async sendPendingTotpNotice(message: PendingTotpNoticeMessage): Promise<void> {
    const email = renderPendingTotpEmail(message);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }

  async sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void> {
    const email = renderEmergencyAlertEmail(message);
    try {
      await this.transport.sendMail({ from: this.options.from, to: message.to, ...email });
    } catch {
      throw new Error('Mail delivery failed');
    }
  }
}
