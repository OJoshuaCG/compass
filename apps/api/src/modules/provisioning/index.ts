/** Fachada pública del módulo `provisioning` (operaciones: alta de organizaciones y recuperación de la Raíz). */
export { BootstrapOrganization } from './application/bootstrap-organization.js';
export type {
  BootstrapInput,
  BootstrapResult,
  OrganizationSeeder,
} from './application/bootstrap-organization.js';
export { PgOrganizationSeeder } from './infrastructure/pg-organization-seeder.js';
export type { CustodyGroup } from './application/emergency-codes.js';
export {
  RecoverRoot,
  ROOT_RECOVERY_REJECTED,
  RootRecoveryRejectedError,
} from './application/recover-root.js';
export type {
  AdministratorContact,
  AdministratorNotifier,
  RootRecoveryInput,
  RootRecoveryResult,
  RootRecoveryStore,
} from './application/recover-root.js';
export { PgRootRecoveryStore } from './infrastructure/pg-root-recovery-store.js';
export { MailerAdministratorNotifier } from './infrastructure/mailer-administrator-notifier.js';
