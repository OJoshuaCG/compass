import type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
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

  get last(): InvitationMessage | undefined {
    return this.sent.at(-1);
  }
}
