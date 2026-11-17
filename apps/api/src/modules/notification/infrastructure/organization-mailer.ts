import type {
  EmergencyAlertMessage,
  InfrastructureAlertMessage,
  InvitationMessage,
  Mailer,
  OffboardingNoticeMessage,
  PendingTotpNoticeMessage,
  RankChangeNoticeMessage,
  ResetRevealAlertMessage,
  RevealLimitAlertMessage,
  RootTransferNoticeMessage,
  SecurityNoticeMessage,
} from '../application/ports/mailer.js';

/**
 * Elige el correo de la organización del contexto actual. Devuelve `null` si esa organización no tiene un
 * servidor SMTP configurado (se usa el de las variables de entorno) y LANZA si lo tiene pero no se puede
 * usar: enviar por otro servidor cambiaría el remitente sin que nadie lo decida.
 */
export interface MailerSelector {
  select(): Promise<Mailer | null>;
}

/**
 * Correo saliente con el servidor SMTP de cada organización (ADR 0047, enmienda del 2026-11-17) y, como
 * respaldo, el de las variables de entorno para las organizaciones sin configuración.
 *
 * La organización sale del contexto de la petición o del evento del outbox, nunca de los mensajes: así un
 * aviso no puede salir por el servidor de otra organización.
 */
export class OrganizationMailer implements Mailer {
  constructor(
    private readonly fallback: Mailer,
    private readonly selector: MailerSelector,
  ) {}

  private async mailer(): Promise<Mailer> {
    return (await this.selector.select()) ?? this.fallback;
  }

  async sendInvitation(message: InvitationMessage): Promise<void> {
    await (await this.mailer()).sendInvitation(message);
  }
  async sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void> {
    await (await this.mailer()).sendEmergencyAlert(message);
  }
  async sendSecurityNotice(message: SecurityNoticeMessage): Promise<void> {
    await (await this.mailer()).sendSecurityNotice(message);
  }
  async sendRevealLimitAlert(message: RevealLimitAlertMessage): Promise<void> {
    await (await this.mailer()).sendRevealLimitAlert(message);
  }
  async sendResetRevealAlert(message: ResetRevealAlertMessage): Promise<void> {
    await (await this.mailer()).sendResetRevealAlert(message);
  }
  async sendPendingTotpNotice(message: PendingTotpNoticeMessage): Promise<void> {
    await (await this.mailer()).sendPendingTotpNotice(message);
  }
  async sendRankChangeNotice(message: RankChangeNoticeMessage): Promise<void> {
    await (await this.mailer()).sendRankChangeNotice(message);
  }
  async sendOffboardingNotice(message: OffboardingNoticeMessage): Promise<void> {
    await (await this.mailer()).sendOffboardingNotice(message);
  }
  async sendRootTransferNotice(message: RootTransferNoticeMessage): Promise<void> {
    await (await this.mailer()).sendRootTransferNotice(message);
  }
  async sendInfrastructureAlert(message: InfrastructureAlertMessage): Promise<void> {
    await (await this.mailer()).sendInfrastructureAlert(message);
  }
}
