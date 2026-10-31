import type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
  PendingTotpNoticeMessage,
  RankChangeNoticeMessage,
  RevealLimitAlertMessage,
  SecurityNoticeMessage,
} from '../application/ports/mailer.js';

/** Doble de prueba: guarda lo "enviado" para que las pruebas lean el token como lo haría el destinatario. */
export class InMemoryMailer implements Mailer {
  readonly sent: InvitationMessage[] = [];
  failNext = false;

  sendInvitation(message: InvitationMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.sent.push(message);
    return Promise.resolve();
  }

  readonly alerts: EmergencyAlertMessage[] = [];

  sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.alerts.push(message);
    return Promise.resolve();
  }

  readonly notices: SecurityNoticeMessage[] = [];

  sendSecurityNotice(message: SecurityNoticeMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.notices.push(message);
    return Promise.resolve();
  }

  readonly revealLimitAlerts: RevealLimitAlertMessage[] = [];

  sendRevealLimitAlert(message: RevealLimitAlertMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.revealLimitAlerts.push(message);
    return Promise.resolve();
  }

  readonly pendingTotpNotices: PendingTotpNoticeMessage[] = [];

  sendPendingTotpNotice(message: PendingTotpNoticeMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.pendingTotpNotices.push(message);
    return Promise.resolve();
  }

  readonly rankChangeNotices: RankChangeNoticeMessage[] = [];

  sendRankChangeNotice(message: RankChangeNoticeMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('mail provider unavailable'));
    }
    this.rankChangeNotices.push(message);
    return Promise.resolve();
  }

  get last(): InvitationMessage | undefined {
    return this.sent.at(-1);
  }
}
