/** Fachada pública del módulo `audit`. */
export { RecordAuditEvent } from './application/record-audit-event.js';
export type { AuditLog } from './application/record-audit-event.js';
export { VerifyAuditChain } from './application/verify-audit-chain.js';
export type { AuditEventRepository } from './application/ports/audit-event-repository.js';
export type {
  AuditEventCountQuery,
  AuditEventCounter,
} from './application/ports/audit-event-counter.js';
export type {
  AuditEvent,
  AuditEventInput,
  AuditMetadata,
  AuditOutcome,
  ChainVerification,
  NewAuditEvent,
} from './domain/audit-event.js';
export { PgAuditEventRepository } from './infrastructure/pg-audit-event-repository.js';
export {
  AUDIT_ANCHOR_RETENTION_YEARS,
  AnchorAuditChain,
  auditAnchorRetainUntil,
} from './application/anchor-audit-chain.js';
export type { AnchorFailure, AnchorSummary } from './application/anchor-audit-chain.js';
export type {
  AnchorFailureAlerter,
  AnchorOrganizationLister,
  AuditAnchorLedger,
  AuditAnchorPublisher,
} from './application/ports/audit-anchor-ports.js';
export type { AuditAnchor, AuditAnchorManifest } from './domain/audit-anchor.js';
export { toAuditAnchorManifest } from './domain/audit-anchor.js';
export { PgAuditAnchorLedger } from './infrastructure/pg-audit-anchor-ledger.js';
export {
  AuditAnchorPublishError,
  S3AuditAnchorPublisher,
} from './infrastructure/s3-audit-anchor-publisher.js';
