/**
 * Raíz de composición: el único lugar que conoce todas las capas y une cada puerto con su adaptador.
 * Los módulos no se importan entre sí salvo por su fachada; el cableado concreto vive aquí.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { Authorizer, ManageRoles, PgRoleRepository } from '../modules/access/index.js';
import { PgAuditEventRepository, RecordAuditEvent } from '../modules/audit/index.js';
import {
  DataKeyResolver,
  DekCache,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../modules/crypto/index.js';
import type { KeyManagementPort } from '../modules/crypto/index.js';
import { IdempotencyService, PgIdempotencyStore } from '../modules/idempotency/index.js';
import {
  CreateUser,
  ListDirectory,
  ListManaged,
  ManageUsers,
  PgUserDirectory,
} from '../modules/directory/index.js';
import {
  AcceptInvitation,
  Argon2PasswordHasher,
  ChangePassword,
  CreateInvitation,
  ListInvitations,
  Passkeys,
  PgChallengeStore,
  PgPasskeyRepository,
  ResendInvitation,
  SimpleWebAuthnEngine,
  GetProfile,
  ListMySessions,
  RevokeMySession,
  InMemoryLoginAttemptStore,
  Login,
  Logout,
  OtplibTotpEngine,
  PgCredentialRepository,
  PgInvitationRepository,
  PgPreAuthLookup,
  PgSessionRepository,
  PreviewInvitation,
  SecondFactor,
  SessionService,
  ZxcvbnPasswordStrength,
} from '../modules/identity/index.js';
import type { Argon2Params } from '../modules/identity/index.js';
import type { Mailer } from '../modules/notification/index.js';
import { PgTenantScope, PgUnitOfWork } from '../modules/organization/index.js';
import type { Clock } from '../shared/kernel/index.js';
import { AsyncLocalRequestContext } from '../shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../shared/infrastructure/system-clock.js';
import { UuidV7Generator } from '../shared/infrastructure/uuid-v7-generator.js';

export interface ContainerOptions {
  /** Pool de la aplicación (rol `iam_app`, sin BYPASSRLS). */
  readonly pool: Pool;
  /** Pool pequeño y separado para transacciones independientes (ver `PgUnitOfWork`). */
  readonly independentPool: Pool;
  readonly mailer: Mailer;
  /** Sitio donde corre la aplicación: de aquí salen el origen y el identificador de las llaves de acceso. */
  readonly webauthn: { readonly rpName: string; readonly rpId: string; readonly origin: string };
  readonly kms: KeyManagementPort;
  readonly logger: Logger;
  /** Solo para pruebas: parámetros de Argon2 más baratos. */
  readonly argon2?: Argon2Params;
  /** Solo para pruebas: reloj controlable. */
  readonly clock?: Clock;
}

export function buildContainer(options: ContainerOptions) {
  const { pool, independentPool, mailer, kms } = options;
  const clock = options.clock ?? new SystemClock();
  const ids = new UuidV7Generator();
  const primitives = new NodeCryptoPrimitives();
  const requestContext = new AsyncLocalRequestContext();
  const uow = new PgUnitOfWork(pool, requestContext, independentPool);
  const scope = new PgTenantScope(requestContext, uow);
  const independently = <T>(fn: () => Promise<T>): Promise<T> => uow.runIndependent(fn);

  // crypto
  const keys = new DataKeyResolver({
    repository: new PgDataKeyRepository(uow),
    kms,
    cache: new DekCache({ clock }),
    clock,
    independently,
  });
  const cipher = new SecretCipher({ keys, primitives });

  // audit
  const audit = new RecordAuditEvent({
    repository: new PgAuditEventRepository(uow),
    context: requestContext,
    ids,
  });

  // directory + access
  const directory = new PgUserDirectory(uow);
  const roles = new PgRoleRepository(uow);
  const authorizer = new Authorizer({
    context: requestContext,
    directory,
    roles,
    audit,
    clock,
    independently,
  });
  const createUser = new CreateUser({ directory, ids });
  const listDirectory = new ListDirectory({ directory, uow });
  const listManaged = new ListManaged({ directory, uow, context: requestContext });

  // identity
  const lookup = new PgPreAuthLookup(pool);
  const sessionRepository = new PgSessionRepository(uow);
  const credentials = new PgCredentialRepository(uow);
  const invitations = new PgInvitationRepository(uow);
  const hasher = new Argon2PasswordHasher(options.argon2);
  const strength = new ZxcvbnPasswordStrength();
  const totp = new OtplibTotpEngine();
  const attempts = new InMemoryLoginAttemptStore();
  const sessions = new SessionService({
    sessions: sessionRepository,
    lookup,
    scope,
    primitives,
    ids,
    clock,
  });

  const passkeyRepository = new PgPasskeyRepository(uow);
  const challenges = new PgChallengeStore(uow);
  const webauthn = new SimpleWebAuthnEngine(options.webauthn);
  const login = new Login({
    lookup,
    hasher,
    attempts,
    scope,
    sessions,
    credentials,
    passkeys: passkeyRepository,
    audit,
    clock,
  });

  return {
    clock,
    ids,
    primitives,
    requestContext,
    uow,
    scope,
    sessions,
    authorizer,
    hasher,
    strength,
    listDirectory,
    listManaged,
    passkeys: new Passkeys({
      context: requestContext,
      uow,
      directory,
      passkeys: passkeyRepository,
      challenges,
      webauthn,
      audit,
      clock,
    }),
    manageRoles: new ManageRoles({
      context: requestContext,
      uow,
      authorizer,
      directory,
      roles,
      ids,
      audit,
      clock,
    }),
    idempotency: new IdempotencyService({
      scope,
      store: new PgIdempotencyStore(uow),
      primitives,
      clock,
    }),
    manageUsers: new ManageUsers({
      context: requestContext,
      uow,
      authorizer,
      directory,
      sessions: sessionRepository,
      invitations,
      audit,
      clock,
    }),
    login,
    logout: new Logout({
      context: requestContext,
      uow,
      sessions: sessionRepository,
      audit,
      clock,
    }),
    secondFactor: new SecondFactor({
      context: requestContext,
      uow,
      directory,
      credentials,
      sessions: sessionRepository,
      cipher,
      totp,
      primitives,
      attempts,
      audit,
      clock,
      mailer,
      passkeys: passkeyRepository,
      challenges,
      webauthn,
    }),
    changePassword: new ChangePassword({
      context: requestContext,
      uow,
      directory,
      credentials,
      sessions: sessionRepository,
      hasher,
      strength,
      attempts,
      audit,
      clock,
    }),
    createInvitation: new CreateInvitation({
      context: requestContext,
      uow,
      authorizer,
      directory,
      roles,
      invitations,
      primitives,
      ids,
      clock,
      audit,
      mailer,
    }),
    listInvitations: new ListInvitations({
      context: requestContext,
      uow,
      authorizer,
      directory,
      invitations,
      clock,
    }),
    resendInvitation: new ResendInvitation({
      context: requestContext,
      uow,
      authorizer,
      directory,
      roles,
      invitations,
      primitives,
      ids,
      clock,
      audit,
      mailer,
    }),
    previewInvitation: new PreviewInvitation({ lookup, primitives, clock }),
    acceptInvitation: new AcceptInvitation({
      directory,
      lookup,
      scope,
      invitations,
      createUser,
      credentials,
      roles,
      sessions,
      hasher,
      strength,
      primitives,
      audit,
      clock,
    }),
    getProfile: new GetProfile({ uow, directory, roles }),
    listMySessions: new ListMySessions({
      context: requestContext,
      uow,
      sessions: sessionRepository,
      clock,
    }),
    revokeMySession: new RevokeMySession({
      context: requestContext,
      uow,
      sessions: sessionRepository,
      audit,
      clock,
    }),
    /** Libera conexiones y borra las DEK de memoria (apagado ordenado). */
    async shutdown(): Promise<void> {
      await login.drain();
      keys.clearCache();
      await Promise.all([pool.end(), independentPool.end()]);
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
