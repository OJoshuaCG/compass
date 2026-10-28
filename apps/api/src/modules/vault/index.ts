/** Fachada pública del módulo `vault`. */
export { ManageAccounts } from './application/manage-accounts.js';
export type {
  CreateAccountInput,
  ManageAccountsDeps,
  UpdateAccountInput,
} from './application/manage-accounts.js';
export type {
  AccountRecord,
  AccountRepository,
  AccountView,
  PlatformRecord,
} from './application/ports/account-repository.js';
export { levelSatisfies } from './domain/share-level.js';
export { PgAccountRepository } from './infrastructure/pg-account-repository.js';
