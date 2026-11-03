/** Fachada pública del módulo `inbound-codes` (ADR 0045): dominio puro (IC-1), recifrado y caso de uso de sondeo (IC-3b). */
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
  DkimKeyBitsPolicy,
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
export { PollMailSource } from './application/poll-mail-source.js';
export type {
  PollMessageRecord,
  PollObserver,
  PollSourceResult,
  PollSummary,
} from './application/poll-mail-source.js';
export type {
  AcceptedRecord,
  InboundRecorder,
  MessageFingerprinter,
  QuarantineRecord,
  RecordOutcome,
  SourceTemplateStore,
} from './application/ports/inbound-recorder.js';
export { MAIL_CONNECTION_LOAD_FAILURES } from './application/ports/mail-connection-loader.js';
export type {
  MailConnection,
  MailConnectionLoader,
  MailConnectionLoadFailure,
  MailConnectionLoadResult,
  MailTlsMode,
} from './application/ports/mail-connection-loader.js';
export {
  MAILBOX_FAILURE_CODES,
  MailboxConnectionError,
  MessageFetchError,
} from './application/ports/mailbox.js';
export type {
  MailboxConnector,
  MailboxFailureCode,
  MailboxMessageSummary,
  MailboxSession,
  RawMessage,
} from './application/ports/mailbox.js';
export { MimeParseError } from './application/ports/mime-and-authenticity.js';
export type {
  AuthenticityAssessment,
  AuthenticityVerdicts,
  AuthenticityVerifier,
  MailHeader,
  MimeParser,
  ParsedMail,
} from './application/ports/mime-and-authenticity.js';
export type {
  PollCursor,
  PollStateStore,
  SourceRef,
} from './application/ports/poll-state-store.js';
export * as pollPolicy from './domain/poll-policy.js';
