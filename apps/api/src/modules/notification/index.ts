/** Fachada pública del módulo `notification`. */
export type {
  EmergencyAlertMessage,
  InvitationMessage,
  Mailer,
  PendingTotpNoticeMessage,
  RankChangeNoticeMessage,
  RevealLimitAlertMessage,
  SecurityNoticeKind,
  SecurityNoticeMessage,
} from './application/ports/mailer.js';
export { InMemoryMailer } from './infrastructure/in-memory-mailer.js';
export { renderInvitationEmail } from './application/render-invitation-email.js';
export { renderPendingTotpEmail } from './application/render-pending-totp-email.js';
export { renderRankChangeEmail } from './application/render-rank-change-email.js';
export { renderRevealLimitEmail } from './application/render-reveal-limit-email.js';
export { SmtpMailer } from './infrastructure/smtp-mailer.js';
export type { MailTransport, SmtpOptions, SmtpSecurity } from './infrastructure/smtp-mailer.js';
export { LogMailer } from './infrastructure/log-mailer.js';
