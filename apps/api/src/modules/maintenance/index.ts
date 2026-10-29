/** Fachada pública del módulo `maintenance`: trabajos de fondo que recorren organizaciones (ADR 0038). */
export {
  PURGE_BATCH_SIZE,
  PURGE_GRACE_MS,
  PurgeExpiredRows,
  type PurgeReport,
} from './application/purge-expired-rows.js';
export type {
  ExpiredRowsPurger,
  OrganizationLister,
} from './application/ports/maintenance-ports.js';
