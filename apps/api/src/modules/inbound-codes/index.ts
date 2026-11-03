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
export { inboundItemContext, INBOUND_ITEM_VALUE_FIELD } from './domain/inbound-item-context.js';
export { PgInboundRecorder } from './infrastructure/pg-inbound-recorder.js';
export { PgMailConnectionLoader } from './infrastructure/pg-mail-connection-loader.js';
export { PgPollStateStore } from './infrastructure/pg-poll-state-store.js';
export { PgSourceTemplateStore } from './infrastructure/pg-source-template-store.js';
export { ReadOnlyDataKeyRepository } from './infrastructure/read-only-data-key-repository.js';
export { Sha256MessageFingerprinter } from './infrastructure/sha256-message-fingerprinter.js';
export { PollInboundSources } from './application/poll-inbound-sources.js';
export type {
  InboundSourcePoller,
  PollInboundSourcesSettings,
  PollInboundSourcesSummary,
} from './application/poll-inbound-sources.js';
export type { PollableSourceLister } from './application/ports/pollable-source-lister.js';
export { PgPollableSourceLister } from './infrastructure/pg-pollable-source-lister.js';
export { LogPollObserver } from './infrastructure/log-poll-observer.js';
export { AuthenticationResultsVerifier } from './infrastructure/authentication-results-verifier.js';
export { ImapFlowMailboxConnector } from './infrastructure/imapflow-mailbox-connector.js';
export { ChildProcessMimeParser } from './infrastructure/mime-child-process-parser.js';
export { NetworkGuard } from './infrastructure/network-guard.js';
export { ReadInboundCodes } from './application/read-inbound-codes.js';
export type {
  DeliveredInboundCode,
  InboundHistoryEntry,
  InboundHistoryPage,
  ReadInboundCodesDeps,
} from './application/read-inbound-codes.js';
export type { InboundViewReader } from './application/ports/inbound-view-reader.js';
export { PgInboundViewReader } from './infrastructure/pg-inbound-view-reader.js';
export { ListInboundDirectory } from './application/list-inbound-directory.js';
export type { ListInboundDirectoryDeps } from './application/list-inbound-directory.js';
export type {
  ConfigurableSourceSummary,
  InboundDirectory,
  ReadableViewSummary,
} from './application/ports/inbound-directory.js';
export { PgInboundDirectory } from './infrastructure/pg-inbound-directory.js';
export { ManageInboundViewShares } from './application/manage-inbound-view-shares.js';
export type { ManageInboundViewSharesDeps } from './application/manage-inbound-view-shares.js';
export type {
  InboundViewShareRepository,
  ViewShareView,
} from './application/ports/inbound-view-share-repository.js';
export { PgInboundViewShareRepository } from './infrastructure/pg-inbound-view-share-repository.js';
export { ManageInboundConfiguration } from './application/manage-inbound-configuration.js';
export type { ManageInboundConfigurationDeps } from './application/manage-inbound-configuration.js';
export type {
  InboundConfigurationRepository,
  SourceRecord,
  ViewRecord,
} from './application/ports/inbound-configuration-repository.js';
export { PgInboundConfigurationRepository } from './infrastructure/pg-inbound-configuration-repository.js';
export { ManageInboundSourceConnection } from './application/manage-inbound-source-connection.js';
export type { ManageInboundSourceConnectionDeps } from './application/manage-inbound-source-connection.js';
export type {
  InboundSourceConnectionRepository,
  PasswordChange,
  SourceConnectionRecord,
  SourceConnectionWrite,
} from './application/ports/inbound-source-connection-repository.js';
export { PgInboundSourceConnectionRepository } from './infrastructure/pg-inbound-source-connection-repository.js';
export { NotifyResetRevealed } from './application/notify-reset-revealed.js';
export type { NotifyResetRevealedDeps } from './application/notify-reset-revealed.js';
export {
  RESET_REVEAL_NOTICE_AGGREGATE,
  RESET_REVEAL_NOTICE_EVENT_TYPE,
  resetRevealNoticeHandlerKey,
  serializeResetRevealNotice,
} from './domain/reset-reveal-notice.js';
export { RevealInboundResets, MAX_RESETS_PER_REVEAL } from './application/reveal-inbound-resets.js';
export type {
  RevealedInboundReset,
  RevealInboundResetsDeps,
} from './application/reveal-inbound-resets.js';
export type {
  InboundResetStore,
  LiveResetRecord,
} from './application/ports/inbound-reset-store.js';
export { PgInboundResetStore } from './infrastructure/pg-inbound-reset-store.js';
