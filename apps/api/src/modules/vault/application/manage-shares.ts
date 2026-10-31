/**
 * Comparticiones de una cuenta de la bóveda: listar, compartir y revocar, por persona y por grupo.
 *
 * Invariantes de seguridad
 * - Dos llaves: el permiso `share.manage` y MANAGE sobre la cuenta concreta. Sin acceso a la cuenta se
 *   responde `NOT_FOUND`; con acceso insuficiente, `AUTHZ.SHARE` y la negación se audita.
 * - Nadie comparte un nivel superior al suyo (PE-7). Hoy MANAGE ya es el máximo, pero la regla se
 *   comprueba por separado para que no dependa de ese detalle.
 * - Compartir y revocar bloquean la fila de la cuenta antes de leer el nivel: dos cambios concurrentes
 *   sobre la misma cuenta se serializan y nadie decide con un nivel que ya venció.
 * - Una compartición vencida deja de dar acceso por sí sola (la vista `effective_access` la ignora); aquí
 *   solo se revoca la fila vencida cuando estorba al compartir de nuevo con el mismo destinatario.
 * - Revocar corta el acceso desde la siguiente petición. Si la persona (o alguien del grupo) reveló una
 *   contraseña de la cuenta y ya no conserva acceso por otra vía, se crea una tarea de rotación en la
 *   misma transacción (decisión pendiente de confirmar: asignada a quien revoca, prioridad alta, 7 días).
 * - Todo cambio escribe su auditoría como último paso (ADR 0023).
 */
import type { CreateShareRequest, Permission, ShareLevel } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  IdGenerator,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { canGrant, levelSatisfies } from '../domain/share-level.js';
import type { AccountRepository } from './ports/account-repository.js';
import type { ShareRepository, ShareView } from './ports/share-repository.js';

export interface ManageSharesDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: AccountRepository;
  readonly shares: ShareRepository;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Una compartición con caducidad no puede durar más de un año: el acceso temporal es la excepción. */
export const MAX_SHARE_EXPIRY_DAYS = 365;

/** Plazo de la tarea de rotación que deja revocar tras una revelación. Por confirmar con el dueño. */
export const ROTATION_TASK_DUE_DAYS = 7;

/** Hasta dónde se mira atrás en la auditoría buscando revelaciones de la persona (como las bajas). */
export const REVEAL_LOOKBACK_DAYS = 180;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Account not found');

const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * MILLISECONDS_PER_DAY);

export class ManageShares {
  constructor(private readonly deps: ManageSharesDeps) {}

  /** Quién tiene acceso a la cuenta y hasta cuándo; solo para quien la gestiona. */
  list(accountId: string): Promise<Result<readonly ShareView[], DomainError>> {
    const { uow, authorizer, accounts, shares, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'share.manage' });
      const actorId = this.requireActorId();

      const account = await accounts.findById(accountId);
      if (account === null || account.status !== 'active') return err(notFound());
      const level = await this.levelOrNotFound(accountId, actorId, 'share.manage', 'MANAGE');
      if (!level.ok) return level;

      return ok(await shares.listLive(accountId, clock.now()));
    });
  }

  share(accountId: string, input: CreateShareRequest): Promise<Result<ShareView, DomainError>> {
    const { context, uow, authorizer, accounts, shares, ids, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'share.manage' });
      const current = context.current();
      const actorId = this.requireActorId();

      const account = await accounts.findByIdForUpdate(accountId);
      if (account === null) return err(notFound());
      const level = await this.levelOrNotFound(account.id, actorId, 'share.manage', 'MANAGE');
      if (!level.ok) return level;
      if (account.status === 'archived') {
        return err(new DomainError('ACCOUNT.ARCHIVED', 'Account is archived'));
      }

      if (!canGrant(level.value, input.level)) {
        await authorizer.auditDenial({
          code: 'AUTHZ.SHARE',
          permission: 'share.manage',
          targetAccountId: account.id,
        });
        return err(new DomainError('AUTHZ.SHARE', 'Cannot share a level above your own'));
      }

      const now = clock.now();
      const expiresAt = input.expiresAt === undefined ? null : new Date(input.expiresAt);
      if (expiresAt !== null && !isAllowedExpiry(expiresAt, now)) {
        return err(
          new DomainError('SHARE.EXPIRY_INVALID', 'Expiry must be in the future and within a year'),
        );
      }

      if (!(await this.granteeIsValid(input, actorId))) {
        return err(new DomainError('SHARE.GRANTEE_INVALID', 'Grantee not found or not active'));
      }

      const open = await shares.findOpenByGrantee(account.id, input.granteeType, input.granteeId);
      if (open !== null) {
        const hasExpired = open.expiresAt !== null && open.expiresAt <= now;
        if (!hasExpired) {
          return err(new DomainError('SHARE.ALREADY_EXISTS', 'Grantee already has access'));
        }
        // La vencida ya no daba acceso, pero el índice único parcial la sigue contando: se cierra.
        await shares.revoke(open.id, now, actorId);
      }

      const shareId = ids.next();
      await shares.insert({
        id: shareId,
        accountId: account.id,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        level: input.level,
        expiresAt,
        grantedBy: actorId,
      });
      const created = await shares.findViewById(account.id, shareId);
      if (created === null) throw new Error('The share just inserted was not found');

      await audit.record({
        action: 'share.granted',
        actorId,
        targetType: 'account',
        targetId: account.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {
          level: input.level,
          granteeType: input.granteeType,
          granteeId: input.granteeId,
          expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
        },
      });
      return ok(created);
    });
  }

  revoke(accountId: string, shareId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, accounts, shares, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'share.manage' });
      const current = context.current();
      const actorId = this.requireActorId();

      const account = await accounts.findByIdForUpdate(accountId);
      if (account === null) return err(notFound());
      const level = await this.levelOrNotFound(account.id, actorId, 'share.manage', 'MANAGE');
      if (!level.ok) return level;

      const share = await shares.findOpenById(account.id, shareId);
      if (share === null) return err(new DomainError('NOT_FOUND', 'Share not found'));

      const now = clock.now();
      await shares.revoke(share.id, now, actorId);
      const rotationTasks = await this.createRotationTasks(
        account.id,
        share.granteeType,
        share.granteeId,
        actorId,
        now,
      );

      await audit.record({
        action: 'share.revoked',
        actorId,
        targetType: 'account',
        targetId: account.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: {
          level: share.level,
          granteeType: share.granteeType,
          granteeId: share.granteeId,
          rotationTasks,
        },
      });
      return ok(undefined);
    });
  }

  /**
   * Una tarea por credencial que alguien revelara y que ya no deba poder ver. Las personas que conservan
   * acceso por otra compartición se descartan: seguirán pudiendo revelarla, rotarla no cambia nada.
   */
  private async createRotationTasks(
    accountId: string,
    granteeType: 'user' | 'group',
    granteeId: string,
    assignedTo: UserId,
    now: Date,
  ): Promise<number> {
    const { accounts, shares } = this.deps;
    const candidates =
      granteeType === 'user' ? [granteeId] : await shares.groupMemberIds(granteeId);

    const withoutAccess: string[] = [];
    for (const userId of candidates) {
      const stillHasAccess = (await accounts.effectiveLevel(accountId, userId as UserId)) !== null;
      if (!stillHasAccess) withoutAccess.push(userId);
    }

    const since = addDays(now, -REVEAL_LOOKBACK_DAYS);
    const revealed = await shares.revealedCredentials(accountId, withoutAccess, since);
    const credentialIds = [...new Set(revealed.map((entry) => entry.credentialId))];

    let created = 0;
    for (const credentialId of credentialIds) {
      if (await shares.openRotationTaskExists(credentialId)) continue;
      await shares.insertRotationTask({
        credentialId,
        triggeredByUser: granteeType === 'user' ? granteeId : null,
        assignedTo,
        dueAt: addDays(now, ROTATION_TASK_DUE_DAYS),
      });
      created += 1;
    }
    return created;
  }

  private async granteeIsValid(input: CreateShareRequest, actorId: UserId): Promise<boolean> {
    const { accounts, shares } = this.deps;
    if (input.granteeType === 'group') return accounts.groupIsLive(input.granteeId);
    // Compartirse a uno mismo no tiene sentido: ya se tiene MANAGE para poder compartir.
    if (input.granteeId === actorId) return false;
    return shares.userIsActive(input.granteeId);
  }

  /** Segunda llave: el nivel de acceso a la cuenta (misma regla que en `ManageAccounts`). */
  private async levelOrNotFound(
    accountId: string,
    actorId: UserId,
    permission: Permission,
    required: ShareLevel,
  ): Promise<Result<ShareLevel, DomainError>> {
    const { authorizer, accounts } = this.deps;
    const level = await accounts.effectiveLevel(accountId, actorId);
    if (level === null) return err(notFound());
    if (!levelSatisfies(level, required)) {
      await authorizer.auditDenial({ code: 'AUTHZ.SHARE', permission, targetAccountId: accountId });
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this account'));
    }
    return ok(level);
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

/** La caducidad debe ser futura y no pasar de `MAX_SHARE_EXPIRY_DAYS` desde ahora. */
function isAllowedExpiry(expiresAt: Date, now: Date): boolean {
  return expiresAt > now && expiresAt <= addDays(now, MAX_SHARE_EXPIRY_DAYS);
}
