/** Fachada pública del módulo `vault`. */
export { ManageAccounts } from './application/manage-accounts.js';
export type {
  CreateAccountInput,
  ManageAccountsDeps,
  UpdateAccountInput,
} from './application/manage-accounts.js';
export { ManageShares } from './application/manage-shares.js';
export type { ManageSharesDeps } from './application/manage-shares.js';
export { ManageCredentials } from './application/manage-credentials.js';
export type {
  CreateCredentialInput,
  ManageCredentialsDeps,
} from './application/manage-credentials.js';
export { ManageTotp } from './application/manage-totp.js';
export type {
  ExportedTotpSecret,
  IssuedTotpCode,
  ManageTotpDeps,
} from './application/manage-totp.js';
export type { TotpGenerator } from './application/ports/totp-generator.js';
export type { TotpRecord, TotpRepository } from './application/ports/totp-repository.js';
export { OtplibTotpGenerator } from './infrastructure/otplib-totp-generator.js';
export { PgTotpRepository } from './infrastructure/pg-totp-repository.js';
export { parseOtpauthUri } from './domain/otpauth-uri.js';
export type { ParsedOtpauthUri, TotpParameters } from './domain/otpauth-uri.js';
export type {
  CredentialRecord,
  CredentialRepository,
  PasswordVersionSummary,
} from './application/ports/credential-repository.js';
export type {
  AccountRecord,
  AccountRepository,
  AccountView,
  PlatformRecord,
} from './application/ports/account-repository.js';
export type {
  ShareRecord,
  ShareRepository,
  ShareView,
} from './application/ports/share-repository.js';
export { canGrant, levelSatisfies } from './domain/share-level.js';
export { PgAccountRepository } from './infrastructure/pg-account-repository.js';
export { PgVaultCredentialRepository } from './infrastructure/pg-credential-repository.js';
export { PgShareRepository } from './infrastructure/pg-share-repository.js';
