/** Fachada pública del módulo `vault`. */
export { ManageAccounts } from './application/manage-accounts.js';
export type {
  CreateAccountInput,
  ManageAccountsDeps,
  UpdateAccountInput,
} from './application/manage-accounts.js';
export { ManageShares } from './application/manage-shares.js';
export type { ManageSharesDeps } from './application/manage-shares.js';
export { ManageCredentials } from './application/manage-credentials.js';
export type {
  CreateCredentialInput,
  ManageCredentialsDeps,
} from './application/manage-credentials.js';
export { ImportCredentials } from './application/import-credentials.js';
export type {
  ImportCommitOutcome,
  ImportCredentialsDeps,
} from './application/import-credentials.js';
export { NotifyRevealLimitExceeded } from './application/notify-reveal-limit-exceeded.js';
export type {
  NotifyRevealLimitExceededDeps,
  RevealLimitNoticeDeliveries,
  RevealLimitNoticeEvent,
} from './application/notify-reveal-limit-exceeded.js';
export {
  REVEAL_LIMIT_NOTICE_EVENT_TYPE,
  REVEAL_LIMIT_NOTICE_HANDLER_KEY,
  revealLimitNoticeHandlerKey,
} from './domain/reveal-limit-notice.js';
export { NotifyPendingTotpUnconfirmed } from './application/notify-pending-totp-unconfirmed.js';
export type {
  NotifyPendingTotpUnconfirmedDeps,
  PendingTotpNoticeDeliveries,
  PendingTotpNoticeEvent,
} from './application/notify-pending-totp-unconfirmed.js';
export {
  EnqueuePendingTotpNotices,
  PENDING_TOTP_SWEEP_BATCH_SIZE,
  PENDING_TOTP_SWEEP_MIN_INTERVAL_MS,
} from './application/enqueue-pending-totp-notices.js';
export type {
  EnqueuePendingTotpNoticesDeps,
  PendingTotpSweepOptions,
  PendingTotpSweepSummary,
} from './application/enqueue-pending-totp-notices.js';
export type { PendingTotpNoticeStore } from './application/ports/pending-totp-notice-store.js';
export {
  PENDING_TOTP_NOTICE_AFTER_HOURS,
  PENDING_TOTP_NOTICE_AFTER_MS,
  PENDING_TOTP_NOTICE_EVENT_TYPE,
  PENDING_TOTP_NOTICE_HANDLER_KEY,
  pendingTotpNoticeHandlerKey,
} from './domain/pending-totp-notice.js';
export { PgPendingTotpNoticeStore } from './infrastructure/pg-pending-totp-notice-store.js';
export { ManageTotp } from './application/manage-totp.js';
export type {
  ExportedTotpSecret,
  IssuedTotpCode,
  ManageTotpDeps,
} from './application/manage-totp.js';
export type { TotpGenerator } from './application/ports/totp-generator.js';
export type { TotpRecord, TotpRepository } from './application/ports/totp-repository.js';
export { OtplibTotpGenerator } from './infrastructure/otplib-totp-generator.js';
export { PgTotpRepository } from './infrastructure/pg-totp-repository.js';
export { parseOtpauthUri } from './domain/otpauth-uri.js';
export type { ParsedOtpauthUri, TotpParameters } from './domain/otpauth-uri.js';
export type {
  CredentialRecord,
  CredentialRepository,
  PasswordVersionSummary,
} from './application/ports/credential-repository.js';
export type {
  AccountRecord,
  AccountRepository,
  AccountView,
  ExistingAccountKey,
  PlatformRecord,
} from './application/ports/account-repository.js';
export type {
  ShareRecord,
  ShareRepository,
  ShareView,
} from './application/ports/share-repository.js';
export { canGrant, levelSatisfies } from './domain/share-level.js';
export { PgAccountRepository } from './infrastructure/pg-account-repository.js';
export { PgVaultCredentialRepository } from './infrastructure/pg-credential-repository.js';
export { PgShareRepository } from './infrastructure/pg-share-repository.js';
