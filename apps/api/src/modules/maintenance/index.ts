/** Fachada pública del módulo `maintenance` (trabajos de fondo, ADR 0038). */
export { PurgeExpiredEphemeral } from './application/purge-expired-ephemeral.js';
export type { PurgeSummary } from './application/purge-expired-ephemeral.js';
export type { ExpiredEphemeralStore, OrganizationLister } from './application/ports/purge-ports.js';
export { PgExpiredEphemeralStore } from './infrastructure/pg-expired-ephemeral-store.js';
export { PgOrganizationLister } from './infrastructure/pg-organization-lister.js';
export { ReencryptSecrets } from './application/reencrypt-secrets.js';
export type {
  ReencryptionOrganizationReport,
  ReencryptionSummary,
} from './application/reencrypt-secrets.js';
export type {
  ReencryptionBatchResult,
  SecretReencryptor,
} from './application/ports/reencryption-ports.js';
export { RotateDataKey } from './application/rotate-data-key.js';
export type { DataKeyRotation, RotationReason } from './application/rotate-data-key.js';
