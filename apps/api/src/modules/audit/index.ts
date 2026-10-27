/** Fachada pública del módulo `audit`. */
export { RecordAuditEvent } from './application/record-audit-event.js';
export type { AuditLog } from './application/record-audit-event.js';
export { VerifyAuditChain } from './application/verify-audit-chain.js';
export type { AuditEventRepository } from './application/ports/audit-event-repository.js';
export type {
  AuditEvent,
  AuditEventInput,
  AuditMetadata,
  AuditOutcome,
  ChainVerification,
  NewAuditEvent,
} from './domain/audit-event.js';
export { PgAuditEventRepository } from './infrastructure/pg-audit-event-repository.js';
