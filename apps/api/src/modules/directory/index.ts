/** Fachada pública del módulo `directory`. */
export { CreateUser } from './application/create-user.js';
export type { CreateUserCommand } from './application/create-user.js';
export { ListDirectory } from './application/list-directory.js';
export type { ListDirectoryQuery } from './application/list-directory.js';
export type {
  DirectoryPage,
  DirectoryQuery,
  DirectoryRow,
  NewUser,
  UserDirectory,
} from './application/ports/user-directory.js';
export {
  canChangeRank,
  canCreateRank,
  canManage,
  canTransferManager,
} from './domain/management-policy.js';
export type { UserRecord, UserStatus, UserSubject } from './domain/user.js';
export { PgUserDirectory } from './infrastructure/pg-user-directory.js';
