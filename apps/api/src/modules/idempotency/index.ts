/** Fachada pública del módulo `idempotency`. */
export { IdempotencyService } from './application/idempotency-service.js';
export type { IdempotencyStore } from './application/ports/idempotency-store.js';
export { PgIdempotencyStore } from './infrastructure/pg-idempotency-store.js';
export { PgExpiredIdempotencyKeysPurger } from './infrastructure/pg-expired-idempotency-keys-purger.js';
export { IdempotencyInterceptor } from './interface/idempotency.interceptor.js';
