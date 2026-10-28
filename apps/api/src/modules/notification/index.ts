/** Fachada pública del módulo `notification`. */
export type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
  SecurityNoticeKind,
  SecurityNoticeMessage,
} from './application/ports/mailer.js';
export { InMemoryMailer } from './infrastructure/in-memory-mailer.js';
export { renderInvitationEmail } from './application/render-invitation-email.js';
export { SmtpMailer } from './infrastructure/smtp-mailer.js';
export type { MailTransport, SmtpOptions, SmtpSecurity } from './infrastructure/smtp-mailer.js';
export { LogMailer } from './infrastructure/log-mailer.js';
