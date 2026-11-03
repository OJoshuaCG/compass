/** Fachada pública del módulo `inbound-codes` (ADR 0045). Por ahora solo expone el dominio puro (IC-1). */
export { evaluateInboundMail, QUARANTINE_REASONS } from './domain/inbound-evaluation.js';
export type {
  ExtractedValue,
  InboundEvaluation,
  InboundMailMessage,
  QuarantineReason,
} from './domain/inbound-evaluation.js';
export { evaluateDkimGate, DKIM_REJECTION_REASONS } from './domain/dkim-gate.js';
export type {
  DkimGateInput,
  DkimGateResult,
  DkimRejectionReason,
  DkimSignatureEvidence,
  HeaderCounts,
} from './domain/dkim-gate.js';
export { findTemplateProblems, INBOUND_ITEM_KINDS } from './domain/inbound-template.js';
export type {
  AllowedLinkRule,
  ExtractionRule,
  FixedLengthCodeRule,
  InboundItemKind,
  InboundTemplate,
  SubjectRule,
  TemplateProblem,
} from './domain/inbound-template.js';
export type { ItemVisibility } from './domain/inbound-classification.js';
export { isItemExpired } from './domain/item-validity.js';
export { ReencryptMailSourcePasswords } from './application/reencrypt-mail-source-passwords.js';
export type {
  MailConnectionSecretStore,
  StaleMailPassword,
} from './application/ports/mail-connection-secret-store.js';
export { PgMailConnectionSecretStore } from './infrastructure/pg-mail-connection-secret-store.js';
export {
  MAIL_SOURCE_PASSWORD_FIELD,
  mailSourcePasswordContext,
} from './domain/mail-source-password-context.js';
