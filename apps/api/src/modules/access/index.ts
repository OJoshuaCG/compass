/** Fachada pública del módulo `access`. */
export { Authorizer } from './application/authorizer.js';
export { DenialGrouper } from './application/denial-grouper.js';
export type { AuthorizationRequest, AuthorizerDeps } from './application/authorizer.js';
export type { RoleRecord, RoleRepository } from './application/ports/role-repository.js';
export { RankRoleAdjuster } from './application/rank-role-adjuster.js';
export { ManageRoles } from './application/manage-roles.js';
export { decide } from './domain/decision.js';
export type { Decision, DenyReason } from './domain/decision.js';
export { effectivePermissions } from './domain/effective-permissions.js';
export { PERMISSION_CEILING, REAUTH_WINDOW_MS, policyFor } from './domain/permission-catalog.js';
export type { Obligation } from './domain/permission-catalog.js';
export {
  checkRoleAssignment,
  isSubsetOfCreator,
  rolesExceedingRank,
} from './domain/role-assignment.js';
export type { RoleAssignmentDenial } from './domain/role-assignment.js';
export {
  SYSTEM_ROLES,
  SYSTEM_ROLES_VERSION,
  SYSTEM_ROLE_KEY_BY_RANK,
  systemRole,
} from './domain/system-roles.js';
export type { SystemRole, SystemRoleKey } from './domain/system-roles.js';
export { PgRoleRepository } from './infrastructure/pg-role-repository.js';
