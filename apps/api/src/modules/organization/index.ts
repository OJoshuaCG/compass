/** Fachada pública del módulo `organization` (kernel). */
export type { UnitOfWork } from './application/ports/unit-of-work.js';
export { PgUnitOfWork } from './infrastructure/pg-unit-of-work.js';
export type { TransactionProvider } from './infrastructure/pg-unit-of-work.js';
