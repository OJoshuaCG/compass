/**
 * Invariantes de seguridad
 * - Solo quien tiene `user.invite` invita, y únicamente a rangos que la matriz de creación permite.
 * - No escalamiento: nadie otorga a un invitado un permiso que no tiene.
 * - El token del enlace tiene 256 bits y solo se guarda su SHA-256; quien invita NUNCA lo ve.
 * - Quien invita no conoce la contraseña del invitado.
 * - Una invitación es de un solo uso y vence a las 72 horas; todas las causas de rechazo se
 *   responden igual (no enumeración).
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  IdGenerator,
  OrganizationId,
  Rank,
  RequestContextReader,
  Result,
} from '../../../shared/kernel/index.js';
import { checkRoleAssignment, effectivePermissions, SYSTEM_ROLES } from '../../access/index.js';
import type { Authorizer, RoleRepository } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { CryptoPrimitives } from '../../crypto/index.js';
import { canCreateRank } from '../../directory/index.js';
import type { CreateUser, UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import type { TenantScope, UnitOfWork } from '../../organization/index.js';
import { invitationExpiry, isInvitationLive } from '../domain/invitation-policy.js';
import { evaluatePassword, personalTokens } from '../domain/password-policy.js';
import { TOKEN_BYTES, toBase64Url } from '../domain/tokens.js';
import type {
  CredentialRepository,
  InvitationRepository,
  PasswordHasher,
  PasswordStrength,
  PreAuthLookup,
} from './ports/identity-ports.js';
import type { SessionService } from './session-service.js';

const encoder = new TextEncoder();
const invalidInvitation = (): DomainError =>
  new DomainError('INVITATION.INVALID', 'Invitation is not valid');

export interface InvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly rank: 1 | 2 | 3;
  readonly expiresAt: Date;
}

// -------------------------------------------------------------------------------------------------

export interface CreateInvitationDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: UserDirectory;
  readonly roles: RoleRepository;
  readonly invitations: InvitationRepository;
  readonly primitives: CryptoPrimitives;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly audit: AuditLog;
  readonly mailer: Mailer;
}

export class CreateInvitation {
  constructor(private readonly deps: CreateInvitationDeps) {}

  execute(input: {
    readonly email: string;
    readonly rank: 1 | 2 | 3;
    readonly roleIds: readonly string[];
  }): Promise<Result<InvitationSummary, DomainError>> {
    const {
      context,
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
    } = this.deps;
    return uow.run(async () => {
      // 1) Permiso (el motor audita cualquier negación en una transacción independiente).
      await authorizer.require({ permission: 'user.invite' });

      const current = context.current();
      const actorId = current.actorId;
      const actor = actorId === null ? null : await directory.findById(actorId);
      if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');

      // 2) Matriz de creación: nadie crea a alguien de su mismo rango o superior.
      if (!canCreateRank(actor.rank, input.rank)) {
        await authorizer.auditDenial({
          code: 'AUTHZ.CREATION_NOT_ALLOWED',
          permission: 'user.invite',
        });
        return err(new DomainError('AUTHZ.CREATION_NOT_ALLOWED', 'Rank not allowed for your role'));
      }

      // 3) No escalamiento de roles.
      const requested = await roles.findByIds(input.roleIds);
      if (requested.length !== new Set(input.roleIds).size) {
        return err(new DomainError('VALIDATION.FAILED', 'Unknown role'));
      }
      const actorPermissions = effectivePermissions(
        await roles.rolePermissionsOf(actor.id),
        actor.rank,
      );
      for (const role of requested) {
        const denial = checkRoleAssignment({
          actorManagesTarget: true, // el invitado quedará bajo el responsable que invita
          actorPermissions,
          rolePermissions: role.permissions,
          targetRank: input.rank,
        });
        if (denial !== null) {
          await authorizer.auditDenial({
            code: 'AUTHZ.ROLE_ESCALATION',
            permission: 'user.invite',
          });
          return err(new DomainError('AUTHZ.ROLE_ESCALATION', 'Cannot grant permissions you lack'));
        }
      }

      // 4) Correo ya registrado en la organización.
      if (await directory.existsByEmail(input.email)) {
        return err(new DomainError('INVITATION.CONFLICT', 'User already exists'));
      }

      const now = clock.now();
      // Una invitación vencida que nadie aceptó no debe impedir volver a invitar al mismo correo.
      await invitations.revokeExpiredForEmail(input.email, now);
      const expiresAt = invitationExpiry(now);
      const token = toBase64Url(primitives.randomBytes(TOKEN_BYTES));
      const id = ids.next();
      const inserted = await invitations.insert({
        id,
        organizationId: current.organizationId,
        email: input.email,
        rank: input.rank,
        invitedBy: actor.id,
        managedBy: actor.id,
        roleIds: input.roleIds,
        tokenHash: primitives.sha256(encoder.encode(token)),
        expiresAt,
      });
      if (inserted === 'conflict') {
        return err(new DomainError('INVITATION.CONFLICT', 'A pending invitation already exists'));
      }

      // El correo sale antes de confirmar: si falla, no queda una invitación sin enviar.
      await mailer.sendInvitation({ to: input.email, token, expiresAt, locale: 'es-MX' });
      await audit.record({
        action: 'user.invited',
        actorId: actor.id,
        targetType: 'invitation',
        targetId: id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { rank: input.rank, roleCount: input.roleIds.length },
      });
      return ok({ id, email: input.email, rank: input.rank, expiresAt });
    });
  }
}

// -------------------------------------------------------------------------------------------------

export class ListInvitations {
  constructor(
    private readonly deps: {
      readonly context: RequestContextReader;
      readonly uow: UnitOfWork;
      readonly authorizer: Authorizer;
      readonly directory: UserDirectory;
      readonly invitations: InvitationRepository;
      readonly clock: Clock;
    },
  ) {}

  /** Las invitaciones pendientes de quien consulta; la Raíz ve las de toda la organización. */
  execute(): Promise<readonly (Omit<InvitationSummary, 'rank'> & PendingExtras)[]> {
    const { context, uow, authorizer, directory, invitations, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'user.invite' });
      const actorId = context.current().actorId;
      const actor = actorId === null ? null : await directory.findById(actorId);
      if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      const pending = await invitations.listPending(actor.rank === 0 ? null : actor.id);
      const now = clock.now();
      return pending.map((row) => ({
        id: row.id,
        email: row.email,
        rank: row.rank as 1 | 2 | 3,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        expired: row.expiresAt <= now,
      }));
    });
  }
}

interface PendingExtras {
  readonly rank: 1 | 2 | 3;
  readonly createdAt: Date;
  readonly expired: boolean;
}

// -------------------------------------------------------------------------------------------------

/**
 * Reenviar invalida la invitación anterior (su enlace deja de servir) y envía una nueva con otro
 * token y otro plazo. Solo quien la envió, o la Raíz, puede reenviarla; el correo se manda antes de
 * confirmar, igual que al invitar.
 */
export class ResendInvitation {
  constructor(private readonly deps: CreateInvitationDeps) {}

  execute(invitationId: string): Promise<Result<InvitationSummary, DomainError>> {
    const {
      context,
      uow,
      authorizer,
      directory,
      invitations,
      primitives,
      ids,
      clock,
      audit,
      mailer,
    } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'user.invite' });
      const current = context.current();
      const actor = current.actorId === null ? null : await directory.findById(current.actorId);
      if (actor === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');

      const old = await invitations.findByIdForUpdate(invitationId);
      const now = clock.now();
      if (old === null || old.acceptedAt !== null || old.revokedAt !== null) {
        return err(invalidInvitation());
      }
      if (old.invitedBy !== actor.id && actor.rank !== 0) {
        await authorizer.auditDenial({
          code: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
          permission: 'user.invite',
        });
        return err(new DomainError('AUTHZ.HIERARCHY.NOT_IN_SUBTREE', 'Action not allowed'));
      }
      if (!canCreateRank(actor.rank, old.rank)) {
        await authorizer.auditDenial({
          code: 'AUTHZ.CREATION_NOT_ALLOWED',
          permission: 'user.invite',
        });
        return err(new DomainError('AUTHZ.CREATION_NOT_ALLOWED', 'Rank not allowed for your role'));
      }

      // Primero se revoca la anterior: solo puede haber una pendiente por correo.
      await invitations.revoke(old.id, now);
      const expiresAt = invitationExpiry(now);
      const token = toBase64Url(primitives.randomBytes(TOKEN_BYTES));
      const id = ids.next();
      const inserted = await invitations.insert({
        id,
        organizationId: current.organizationId,
        email: old.email,
        rank: old.rank,
        invitedBy: old.invitedBy,
        managedBy: old.managedBy,
        roleIds: old.roleIds,
        tokenHash: primitives.sha256(encoder.encode(token)),
        expiresAt,
      });
      if (inserted === 'conflict') {
        return err(new DomainError('INVITATION.CONFLICT', 'A pending invitation already exists'));
      }
      await mailer.sendInvitation({ to: old.email, token, expiresAt, locale: 'es-MX' });
      await audit.record({
        action: 'user.invitation_resent',
        actorId: actor.id,
        targetType: 'invitation',
        targetId: id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { rank: old.rank, roleCount: old.roleIds.length },
      });
      return ok({ id, email: old.email, rank: old.rank as 1 | 2 | 3, expiresAt });
    });
  }
}

// -------------------------------------------------------------------------------------------------

export class PreviewInvitation {
  constructor(
    private readonly deps: {
      readonly lookup: PreAuthLookup;
      readonly primitives: CryptoPrimitives;
      readonly clock: Clock;
    },
  ) {}

  async execute(token: string): Promise<Result<Omit<InvitationSummary, 'id'>, DomainError>> {
    const { lookup, primitives, clock } = this.deps;
    const found = await lookup.findInvitationByTokenHash(primitives.sha256(encoder.encode(token)));
    if (
      found === null ||
      !isInvitationLive({
        now: clock.now(),
        expiresAt: found.expiresAt,
        acceptedAt: found.acceptedAt,
        revokedAt: found.revokedAt,
      })
    ) {
      return err(invalidInvitation());
    }
    return ok({ email: found.email, rank: found.rank as 1 | 2 | 3, expiresAt: found.expiresAt });
  }
}

// -------------------------------------------------------------------------------------------------

export interface AcceptInvitationDeps {
  readonly directory: UserDirectory;
  readonly lookup: PreAuthLookup;
  readonly scope: TenantScope;
  readonly invitations: InvitationRepository;
  readonly createUser: CreateUser;
  readonly credentials: CredentialRepository;
  readonly roles: RoleRepository;
  readonly sessions: SessionService;
  readonly hasher: PasswordHasher;
  readonly strength: PasswordStrength;
  readonly primitives: CryptoPrimitives;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

const ROLE_NAME_BY_RANK: Readonly<Record<Rank, string>> = {
  0: 'Root',
  1: 'Administrator',
  2: 'Leader',
  3: 'Operator',
};

export class AcceptInvitation {
  constructor(private readonly deps: AcceptInvitationDeps) {}

  async execute(input: {
    readonly token: string;
    readonly displayName: string;
    readonly password: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
    readonly requestId: string;
  }): Promise<Result<{ token: string; expiresAt: Date }, DomainError>> {
    const {
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
    } = this.deps;

    const found = await lookup.findInvitationByTokenHash(
      primitives.sha256(encoder.encode(input.token)),
    );
    const live = (acceptedAt: Date | null, revokedAt: Date | null, expiresAt: Date): boolean =>
      isInvitationLive({ now: clock.now(), expiresAt, acceptedAt, revokedAt });
    if (found === null || !live(found.acceptedAt, found.revokedAt, found.expiresAt)) {
      return err(invalidInvitation());
    }

    const problem = evaluatePassword({
      password: input.password,
      score: strength.score(input.password, personalTokens(found.email, input.displayName)),
      personalTokens: personalTokens(found.email, input.displayName),
    });
    if (problem !== null) return err(new DomainError('PASSWORD.WEAK', 'Password is too weak'));

    const passwordHash = await hasher.hash(input.password);
    const organizationId: OrganizationId = found.organizationId;

    return scope.runAsAtomic(
      { organizationId, actorId: null, requestId: input.requestId },
      async () => {
        // Se bloquea la fila: dos aceptaciones simultáneas del mismo enlace no pasan ambas.
        const invitation = await invitations.findByIdForUpdate(found.invitationId);
        if (
          invitation === null ||
          !live(invitation.acceptedAt, invitation.revokedAt, invitation.expiresAt)
        ) {
          return err(invalidInvitation());
        }
        // Los roles se revalidan AHORA: entre invitar y aceptar pueden haber pasado 72 horas y el
        // responsable pudo perder permisos, o el rol cambiar o archivarse. Todo se ve igual que una
        // invitación inválida (no se revela por qué).
        const inviter = await directory.findById(invitation.invitedBy);
        if (inviter?.status !== 'active') return err(invalidInvitation());
        const requested = await roles.findByIds(invitation.roleIds);
        if (requested.length !== new Set(invitation.roleIds).size) return err(invalidInvitation());
        const inviterPermissions = effectivePermissions(
          await roles.rolePermissionsOf(inviter.id),
          inviter.rank,
        );
        // El responsable debe seguir teniendo el permiso de invitar y poder crear ese rango (pudo
        // ser degradado o perder el permiso durante las 72 horas).
        if (
          !inviterPermissions.has('user.invite') ||
          !canCreateRank(inviter.rank, invitation.rank)
        ) {
          return err(invalidInvitation());
        }
        for (const role of requested) {
          const denial = checkRoleAssignment({
            actorManagesTarget: true,
            actorPermissions: inviterPermissions,
            rolePermissions: role.permissions,
            targetRank: invitation.rank,
          });
          if (denial !== null) return err(invalidInvitation());
        }

        const created = await createUser.execute({
          organizationId,
          email: invitation.email,
          displayName: input.displayName.trim(),
          rank: invitation.rank,
          managedBy: invitation.managedBy,
          createdBy: invitation.invitedBy,
        });
        if (!created.ok) {
          // Cualquier problema con el responsable se ve igual que una invitación inválida.
          return err(
            created.error.code === 'INVITATION.CONFLICT' ? created.error : invalidInvitation(),
          );
        }
        const user = created.value;
        await credentials.savePassword(user.id, passwordHash, false);

        // Rol por defecto de su rango, más los que se pidieron al invitar.
        const base = await roles.findSystemRole(ROLE_NAME_BY_RANK[invitation.rank]);
        const roleIds = [...new Set([...(base === null ? [] : [base.id]), ...invitation.roleIds])];
        for (const roleId of roleIds) await roles.assign(user.id, roleId, invitation.invitedBy);

        await invitations.markAccepted(invitation.id, clock.now());
        const session = await sessions.issue({
          organizationId,
          userId: user.id,
          ip: input.ip,
          userAgent: input.userAgent,
        });
        await audit.record({
          action: 'user.invitation_accepted',
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          outcome: 'success',
          reasonCode: null,
          ip: input.ip,
          requestId: input.requestId,
          metadata: {},
        });
        return ok({ token: session.token, expiresAt: session.expiresAt });
      },
    );
  }
}

/** Los nombres de rol por defecto deben existir como plantillas del sistema (guardia contra desvíos). */
export const DEFAULT_ROLE_NAMES: readonly string[] = SYSTEM_ROLES.map((role) => role.name);
