/** Fachada pública del módulo `outbox` (publicador de eventos, ADR 0035). */
export { OutboxHandlerRegistry } from './application/handler-registry.js';
export {
  OutboxWorker,
  OUTBOX_MAX_EVENTS_PER_ORGANIZATION_PER_RUN,
} from './application/outbox-worker.js';
export type {
  OutboxOutcome,
  OutboxRunOptions,
  OutboxRunSummary,
} from './application/outbox-worker.js';
export type { OutboxLogger, OutboxOrganizationSource } from './application/ports/outbox-ports.js';
export type { OutboxDeliveryReceipts } from './application/ports/outbox-delivery-receipts.js';
export type { OutboxRepository } from './application/ports/outbox-repository.js';
export { OUTBOX_FAILURE_CODES } from './domain/outbox-event.js';
export type { OutboxEvent, OutboxEventHandler, OutboxFailureCode } from './domain/outbox-event.js';
export {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_HANDLER_TIMEOUT_MS,
  OUTBOX_MAX_ATTEMPTS,
  computeBackoffMs,
  isNonRetryableError,
} from './domain/retry-policy.js';
export { OUTBOX_STOP_TIMEOUT_MS, OutboxPoller } from './infrastructure/outbox-poller.js';
export type { OutboxPassRunner } from './infrastructure/outbox-poller.js';
export { PgOutboxDeliveryReceipts } from './infrastructure/pg-outbox-delivery-receipts.js';
export { PgOutboxRepository } from './infrastructure/pg-outbox-repository.js';
