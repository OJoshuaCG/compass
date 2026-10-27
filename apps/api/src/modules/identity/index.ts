/** Fachada pública del módulo `identity`. */
export {
  AcceptInvitation,
  CreateInvitation,
  PreviewInvitation,
} from './application/invitations.js';
export type { InvitationSummary } from './application/invitations.js';
export { ChangePassword } from './application/change-password.js';
export { Login } from './application/login.js';
export type { LoginCommand, LoginOutcome } from './application/login.js';
export { Logout } from './application/logout.js';
export {
  EMERGENCY_CODE_COUNT,
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_RANDOM_BYTES,
} from './domain/recovery-codes.js';
export { Passkeys } from './application/passkeys.js';
export { PgChallengeStore } from './infrastructure/pg-challenge-store.js';
export { PgPasskeyRepository } from './infrastructure/pg-passkey-repository.js';
export { SimpleWebAuthnEngine } from './infrastructure/simplewebauthn-engine.js';
export type { WebAuthnConfig } from './infrastructure/simplewebauthn-engine.js';
export { ListInvitations, ResendInvitation } from './application/invitations.js';
export { ListMySessions, RevokeMySession } from './application/my-sessions.js';
export { GetProfile } from './application/profile.js';
export type { Profile } from './application/profile.js';
export type {
  CredentialRepository,
  InvitationRepository,
  LoginAttemptStore,
  PasswordHasher,
  PasswordStrength,
  PreAuthLookup,
  SessionRepository,
  TotpEngine,
} from './application/ports/identity-ports.js';
export { SecondFactor } from './application/second-factor.js';
export { SessionService } from './application/session-service.js';
export type { AuthenticatedPrincipal, IssuedSession } from './application/session-service.js';
export { evaluatePassword, personalTokens } from './domain/password-policy.js';
export type { PasswordProblem } from './domain/password-policy.js';
export { REAUTH_WINDOW_MS } from '../access/index.js';
export {
  Argon2PasswordHasher,
  OWASP_ARGON2_PARAMS,
} from './infrastructure/argon2-password-hasher.js';
export { InMemoryLoginAttemptStore } from './infrastructure/in-memory-login-attempt-store.js';
export { OtplibTotpEngine } from './infrastructure/otplib-totp-engine.js';
export { PgCredentialRepository } from './infrastructure/pg-credential-repository.js';
export { PgInvitationRepository } from './infrastructure/pg-invitation-repository.js';
export { PgPreAuthLookup } from './infrastructure/pg-pre-auth-lookup.js';
export { PgSessionRepository } from './infrastructure/pg-session-repository.js';
export { ZxcvbnPasswordStrength } from './infrastructure/zxcvbn-password-strength.js';
export type { Argon2Params } from './infrastructure/argon2-password-hasher.js';
