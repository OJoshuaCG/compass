/** Fachada pública del módulo `notification`. */
export type {
  EmergencyAlertMessage,
  InfrastructureAlertMessage,
  InvitationMessage,
  Mailer,
  PendingTotpNoticeMessage,
  OffboardingNoticeMessage,
  RankChangeNoticeMessage,
  ResetRevealAlertMessage,
  RevealLimitAlertMessage,
  RootTransferNoticeMessage,
  SecurityNoticeKind,
  SecurityNoticeMessage,
} from './application/ports/mailer.js';
export { InMemoryMailer } from './infrastructure/in-memory-mailer.js';
export {
  buildInvitationLink,
  renderInvitationEmail,
} from './application/render-invitation-email.js';
export { renderPendingTotpEmail } from './application/render-pending-totp-email.js';
export { renderOffboardingEmail } from './application/render-offboarding-email.js';
export { renderRootTransferEmail } from './application/render-root-transfer-email.js';
export { renderRankChangeEmail } from './application/render-rank-change-email.js';
export { renderRevealLimitEmail } from './application/render-reveal-limit-email.js';
export { renderResetRevealEmail } from './application/render-reset-reveal-email.js';
export { renderInfrastructureAlertEmail } from './application/render-infrastructure-alert-email.js';
export { SMTP_WORST_CASE_ATTEMPT_MS, SmtpMailer } from './infrastructure/smtp-mailer.js';
export type { MailTransport, SmtpOptions, SmtpSecurity } from './infrastructure/smtp-mailer.js';
export { LogMailer } from './infrastructure/log-mailer.js';
