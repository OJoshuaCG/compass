/** Fachada pública del módulo `provisioning` (operaciones: alta de organizaciones). */
export { BootstrapOrganization } from './application/bootstrap-organization.js';
export type {
  BootstrapInput,
  BootstrapResult,
  OrganizationSeeder,
} from './application/bootstrap-organization.js';
export { PgOrganizationSeeder } from './infrastructure/pg-organization-seeder.js';
