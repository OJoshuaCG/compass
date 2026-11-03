/**
 * Comparticiones de una vista de correo entrante: listar, compartir y revocar (ADR 0045, IC-5b).
 *
 * Invariantes de seguridad
 * - Dos llaves: el permiso `share.manage` y MANAGE sobre la VISTA concreta. Sin acceso a la vista se
 *   responde `NOT_FOUND`; con acceso insuficiente, `AUTHZ.SHARE`. En ambos casos la negación se audita.
 * - Nadie comparte un nivel superior al suyo (ADR 0012).
 * - Si la fuente está ligada a una cuenta de la bóveda, quien comparte debe tener al menos USE sobre esa
 *   cuenta: una vista no es una vía para dar acceso a algo que el propio actor no puede usar.
 * - Compartir y revocar bloquean la fila de la vista antes de leer el nivel: dos cambios concurrentes se
 *   serializan y nadie decide con un nivel que ya venció.
 * - Una compartición vencida deja de dar acceso por sí sola (la vista `effective_access` la ignora); aquí
 *   solo se cierra la fila vencida cuando estorba al compartir de nuevo con el mismo destinatario.
 * - Revocar corta el acceso desde la siguiente petición. Si la fuente está ligada a una cuenta de la
 *   bóveda y alguien que pierde MANAGE sobre la vista reveló un restablecimiento desde ella (ADR 0045 §5),
 *   se crea una tarea de rotación por cada credencial viva de la cuenta: el enlace o código externo puede
 *   seguir sirviendo horas después y una toma de la cuenta compromete todas sus credenciales. Los
 *   `login_code` no generan tarea (vencen en minutos y se leen con USE, no se revelan).
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
import {
  canGrant,
  levelSatisfies,
  REVEAL_LOOKBACK_DAYS,
  ROTATION_TASK_DUE_DAYS,
} from '../../vault/index.js';
import type { ShareRepository } from '../../vault/index.js';
import type {
  InboundViewShareRepository,
  ShareableView,
  ViewShareView,
} from './ports/inbound-view-share-repository.js';
// Solo quien conserva el nivel con que se revela puede volver a revelar: rotar no le quita nada.
import { REVEAL_REQUIRED_LEVEL } from './reveal-inbound-resets.js';

const SHARE_PERMISSION: Permission = 'share.manage';
const REQUIRED_VIEW_LEVEL: ShareLevel = 'MANAGE';
const REQUIRED_ACCOUNT_LEVEL: ShareLevel = 'USE';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Misma tope que las cuentas: el acceso temporal es la excepción y no pasa de un año. */
export const MAX_VIEW_SHARE_EXPIRY_DAYS = 365;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Inbound view not found');

const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * MILLISECONDS_PER_DAY);

export interface ManageInboundViewSharesDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly shares: InboundViewShareRepository;
  /** Las tareas de rotación son de la bóveda: se reutiliza su repositorio para no duplicar el SQL. */
  readonly rotations: Pick<ShareRepository, 'openRotationTaskExists' | 'insertRotationTask'>;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export class ManageInboundViewShares {
  constructor(private readonly deps: ManageInboundViewSharesDeps) {}

  /** Quién tiene acceso a la vista y hasta cuándo; solo para quien la gestiona. */
  list(viewId: string): Promise<Result<readonly ViewShareView[], DomainError>> {
    const { uow, authorizer, shares, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SHARE_PERMISSION });
      const actorId = this.requireActorId();

      const view = await shares.findView(viewId);
      if (view === null) return this.denyUnknownView(viewId);
      const level = await this.viewLevelOrDeny(view.id, actorId);
      if (!level.ok) return level;

      return ok(await shares.listLive(view.id, clock.now()));
    });
  }

  share(viewId: string, input: CreateShareRequest): Promise<Result<ViewShareView, DomainError>> {
    const { context, uow, authorizer, shares, ids, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SHARE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const view = await shares.findViewForUpdate(viewId);
      if (view === null) return this.denyUnknownView(viewId);
      const level = await this.viewLevelOrDeny(view.id, actorId);
      if (!level.ok) return level;

      if (!canGrant(level.value, input.level)) {
        await this.auditViewDenial(view.id);
        return err(new DomainError('AUTHZ.SHARE', 'Cannot share a level above your own'));
      }

      const accountCheck = await this.requireAccountUse(view, actorId);
      if (!accountCheck.ok) return accountCheck;

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

      const open = await shares.findOpenByGrantee(view.id, input.granteeType, input.granteeId);
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
        viewId: view.id,
        granteeType: input.granteeType,
        granteeId: input.granteeId,
        level: input.level,
        expiresAt,
        grantedBy: actorId,
      });
      const created = await shares.findViewShareById(view.id, shareId);
      if (created === null) throw new Error('The share just inserted was not found');

      await audit.record({
        action: 'inbound.view_shared',
        actorId,
        targetType: 'mail_view',
        targetId: view.id,
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

  revoke(viewId: string, shareId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, shares, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: SHARE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const view = await shares.findViewForUpdate(viewId);
      if (view === null) return this.denyUnknownView(viewId);
      const level = await this.viewLevelOrDeny(view.id, actorId);
      if (!level.ok) return level;

      const share = await shares.findOpenById(view.id, shareId);
      if (share === null) return err(new DomainError('NOT_FOUND', 'Share not found'));

      const now = clock.now();
      await shares.revoke(share.id, now, actorId);
      const rotationTasks = await this.createRotationTasks(
        view,
        share.granteeType,
        share.granteeId,
        actorId,
        now,
      );

      await audit.record({
        action: 'inbound.view_share_revoked',
        actorId,
        targetType: 'mail_view',
        targetId: view.id,
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
   * Una tarea por credencial viva de la cuenta ligada cuando alguien que pierde MANAGE sobre la vista
   * reveló un restablecimiento desde ella dentro de la ventana de revelaciones de la bóveda. Sin cuenta
   * ligada no hay nada que rotar en la bóveda. Si ya hay una tarea abierta por revocación, no se repite.
   */
  private async createRotationTasks(
    view: ShareableView,
    granteeType: 'user' | 'group',
    granteeId: string,
    assignedTo: UserId,
    now: Date,
  ): Promise<number> {
    if (view.accountId === null) return 0;
    const { shares, rotations } = this.deps;
    await shares.lockAccountForRotation(view.accountId);

    const candidates =
      granteeType === 'user' ? [granteeId] : await shares.groupMemberIds(granteeId);
    const withoutRevealAccess: string[] = [];
    for (const userId of candidates) {
      const remainingLevel = await shares.viewLevel(view.id, userId as UserId);
      const canStillReveal =
        remainingLevel !== null && levelSatisfies(remainingLevel, REVEAL_REQUIRED_LEVEL);
      if (!canStillReveal) withoutRevealAccess.push(userId);
    }

    const since = addDays(now, -REVEAL_LOOKBACK_DAYS);
    const revealers = await shares.usersWhoRevealedResets(view.id, withoutRevealAccess, since);
    if (revealers.length === 0) return 0;

    const credentialIds = await shares.liveCredentialIds(view.accountId);
    let created = 0;
    for (const credentialId of credentialIds) {
      if (await rotations.openRotationTaskExists(credentialId)) continue;
      await rotations.insertRotationTask({
        credentialId,
        triggeredByUser: granteeType === 'user' ? granteeId : null,
        assignedTo,
        dueAt: addDays(now, ROTATION_TASK_DUE_DAYS),
      });
      created += 1;
    }
    return created;
  }

  /**
   * Una fuente ligada a una cuenta de la bóveda solo se comparte a quien puede usar esa cuenta. Quien ya
   * administra la vista puede saber que hay una cuenta detrás, así que se niega con `AUTHZ.SHARE` y se
   * audita. La cuenta se bloquea antes de leer el nivel: revocar el acceso del actor a la cuenta (que
   * bloquea esa misma fila) no puede colarse entre la lectura y el alta de la compartición.
   */
  private async requireAccountUse(
    view: ShareableView,
    actorId: UserId,
  ): Promise<Result<void, DomainError>> {
    if (view.accountId === null) return ok(undefined);
    await this.deps.shares.lockAccountForShare(view.accountId);
    const accountLevel = await this.deps.shares.accountLevel(view.accountId, actorId);
    if (accountLevel === null || !levelSatisfies(accountLevel, REQUIRED_ACCOUNT_LEVEL)) {
      await this.auditViewDenial(view.id);
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to the linked account'));
    }
    return ok(undefined);
  }

  private async granteeIsValid(input: CreateShareRequest, actorId: UserId): Promise<boolean> {
    const { shares } = this.deps;
    if (input.granteeType === 'group') return shares.groupIsLive(input.granteeId);
    // Compartirse a uno mismo no tiene sentido: ya se tiene MANAGE para poder compartir.
    if (input.granteeId === actorId) return false;
    return shares.userIsActive(input.granteeId);
  }

  /** Segunda llave: el nivel de acceso a la vista. Sin acceso `NOT_FOUND`; con menos de MANAGE, `AUTHZ.SHARE`. */
  private async viewLevelOrDeny(
    viewId: string,
    actorId: UserId,
  ): Promise<Result<ShareLevel, DomainError>> {
    const level = await this.deps.shares.viewLevel(viewId, actorId);
    if (level === null) return this.denyUnknownView(viewId);
    if (!levelSatisfies(level, REQUIRED_VIEW_LEVEL)) {
      await this.auditViewDenial(viewId);
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this inbound view'));
    }
    return ok(level);
  }

  /** Vista inexistente, archivada o sin nivel se responden igual, y el intento se audita. */
  private async denyUnknownView(viewId: string): Promise<Result<never, DomainError>> {
    await this.auditViewDenial(viewId);
    return err(notFound());
  }

  private async auditViewDenial(viewId: string): Promise<void> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.SHARE',
      permission: SHARE_PERMISSION,
      targetViewId: viewId,
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

/** La caducidad debe ser futura y no pasar de `MAX_VIEW_SHARE_EXPIRY_DAYS` desde ahora. */
function isAllowedExpiry(expiresAt: Date, now: Date): boolean {
  return expiresAt > now && expiresAt <= addDays(now, MAX_VIEW_SHARE_EXPIRY_DAYS);
}
