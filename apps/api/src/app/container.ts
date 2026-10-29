/**
 * Raíz de composición: el único lugar que conoce todas las capas y une cada puerto con su adaptador.
 * Los módulos no se importan entre sí salvo por su fachada; el cableado concreto vive aquí.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import {
  Authorizer,
  DenialGrouper,
  ManageRoles,
  PgRoleRepository,
} from '../modules/access/index.js';
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
import { PgOrganizationLister, RotateDataKey } from '../modules/maintenance/index.js';
import {
  OutboxHandlerRegistry,
  OutboxPoller,
  OutboxWorker,
  PgOutboxDeliveryReceipts,
  PgOutboxRepository,
} from '../modules/outbox/index.js';
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
import {
  ManageAccounts,
  ManageShares,
  ManageCredentials,
  ManageTotp,
  NotifyRevealLimitExceeded,
  OtplibTotpGenerator,
  PgAccountRepository,
  PgTotpRepository,
  PgShareRepository,
  PgVaultCredentialRepository,
  REVEAL_LIMIT_NOTICE_EVENT_TYPE,
  revealLimitNoticeHandlerKey,
} from '../modules/vault/index.js';
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
  /** Pausa entre pasadas del publicador del outbox (ms); ver `OUTBOX_POLL_INTERVAL_MS`. */
  readonly outboxPollIntervalMs?: number;
}

/** Pausa por defecto entre pasadas del publicador; la configuración de la API la sobrescribe. */
const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 5000;

export function buildContainer(options: ContainerOptions) {
  const { pool, independentPool, mailer, kms, logger } = options;
  // Único rastro de un aviso de seguridad que ni salió ni pudo auditarse: solo el tipo, sin destinatario.
  const reportNoticeLost = (kind: string): void => {
    logger.error({ kind }, 'security notice lost: delivery and its audit event both failed');
  };
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
  const auditEvents = new PgAuditEventRepository(uow);
  const audit = new RecordAuditEvent({
    repository: auditEvents,
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
    denialGrouper: new DenialGrouper(clock),
    independently,
  });
  const createUser = new CreateUser({ directory, ids });
  const listDirectory = new ListDirectory({ directory, uow, authorizer });
  const listManaged = new ListManaged({ directory, uow, authorizer });

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

  // outbox: cada módulo registra sus manejadores en `outboxHandlers` antes de llamar a
  // `outboxPoller.start()`. Un tipo sin manejador espera pendiente, sin gastar intentos, hasta que se registre.
  const outboxHandlers = new OutboxHandlerRegistry();
  const outboxDeliveryReceipts = new PgOutboxDeliveryReceipts(uow, uow);
  // Aviso a la Raíz por superar el tope de revelaciones (ADR 0031, R2a). Usa el puerto de correo existente.
  const notifyRevealLimitExceeded = new NotifyRevealLimitExceeded({
    directory,
    mailer,
    clock,
    deliveries: {
      wasDelivered: (eventId, recipientId) =>
        outboxDeliveryReceipts.wasDelivered(eventId, revealLimitNoticeHandlerKey(recipientId)),
      markDelivered: (eventId, recipientId) =>
        outboxDeliveryReceipts.markDelivered(eventId, revealLimitNoticeHandlerKey(recipientId)),
    },
  });
  outboxHandlers.register(REVEAL_LIMIT_NOTICE_EVENT_TYPE, (event) =>
    notifyRevealLimitExceeded.handle({ eventId: event.id, payload: event.payload }),
  );
  const outboxWorker = new OutboxWorker({
    organizations: new PgOrganizationLister(pool),
    repository: new PgOutboxRepository(uow),
    scope,
    handlers: outboxHandlers,
    ids,
    clock,
    logger,
  });
  const outboxPoller = new OutboxPoller({
    worker: outboxWorker,
    logger,
    intervalMs: options.outboxPollIntervalMs ?? DEFAULT_OUTBOX_POLL_INTERVAL_MS,
  });

  return {
    clock,
    ids,
    outboxHandlers,
    outboxWorker,
    outboxPoller,
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
      mailer,
      reportLost: reportNoticeLost,
    }),
    rotateDataKey: new RotateDataKey({
      context: requestContext,
      uow,
      authorizer,
      audit,
      keys,
      cipher,
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
    manageAccounts: new ManageAccounts({
      context: requestContext,
      uow,
      authorizer,
      accounts: new PgAccountRepository(uow),
      ids,
      audit,
      clock,
    }),
    manageShares: new ManageShares({
      context: requestContext,
      uow,
      authorizer,
      accounts: new PgAccountRepository(uow),
      shares: new PgShareRepository(uow),
      ids,
      audit,
      clock,
    }),
    manageCredentials: new ManageCredentials({
      context: requestContext,
      uow,
      authorizer,
      accounts: new PgAccountRepository(uow),
      credentials: new PgVaultCredentialRepository(uow),
      cipher,
      audit,
      auditCounter: auditEvents,
      ids,
      clock,
    }),
    manageTotp: new ManageTotp({
      context: requestContext,
      uow,
      authorizer,
      accounts: new PgAccountRepository(uow),
      credentials: new PgVaultCredentialRepository(uow),
      totps: new PgTotpRepository(uow),
      cipher,
      generator: new OtplibTotpGenerator(),
      audit,
      auditCounter: auditEvents,
      ids,
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
      reportLost: reportNoticeLost,
      passkeys: passkeyRepository,
      challenges,
      webauthn,
      tokens: sessions,
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
      // Primero el publicador: espera a la pasada en curso antes de cerrar los pools que usa.
      await outboxPoller.stop();
      await login.drain();
      keys.clearCache();
      await Promise.all([pool.end(), independentPool.end()]);
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
