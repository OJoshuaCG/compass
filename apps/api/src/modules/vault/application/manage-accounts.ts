/**
 * Cuentas de la bóveda: catálogo de plataformas, crear, consultar, editar, archivar, listado e inventario.
 *
 * Invariantes de seguridad
 * - Dos llaves: el permiso del catálogo (qué puede hacer la persona) y el nivel de acceso a la cuenta
 *   concreta (a cuáles). Hacen falta las dos; el rango nunca concede acceso a una cuenta (ADR 0010).
 * - Sin acceso a la cuenta se responde `NOT_FOUND`, igual que si no existiera: no se revela que existe.
 *   Con acceso insuficiente se responde `AUTHZ.SHARE` y la negación se audita.
 * - Quien crea una cuenta recibe MANAGE directo en la misma transacción; sin eso nadie podría verla.
 * - Archivar revoca todas las comparticiones en la misma transacción. Los secretos se conservan.
 * - El inventario (`vault.inventory.read`) muestra solo metadatos y no concede ningún nivel de acceso.
 * - Todo cambio escribe su auditoría en la misma transacción, como último paso (ADR 0023).
 */
import type { Permission, ShareLevel } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  Clock,
  IdGenerator,
  KeysetPage,
  KeysetRequest,
  RequestContextReader,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { levelSatisfies } from '../domain/share-level.js';
import type {
  AccountRecord,
  AccountRepository,
  AccountView,
  PlatformRecord,
} from './ports/account-repository.js';

export interface ManageAccountsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly accounts: AccountRepository;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface CreateAccountInput {
  readonly platformId: string;
  readonly displayName: string;
  readonly handle?: string | undefined;
  readonly ownerGroupId?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface UpdateAccountInput {
  readonly displayName?: string | undefined;
  readonly handle?: string | null | undefined;
  readonly ownerGroupId?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
}

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Account not found');

/** Los tags se guardan sin repetidos y en el orden en que llegaron. */
const uniqueTags = (tags: readonly string[]): string[] => [...new Set(tags)];

export class ManageAccounts {
  constructor(private readonly deps: ManageAccountsDeps) {}

  listPlatforms(): Promise<readonly PlatformRecord[]> {
    const { uow, authorizer, accounts } = this.deps;
    return uow.run(async () => {
      await authorizer.requireActiveMember();
      return accounts.listPlatforms();
    });
  }

  /** Las cuentas a las que la persona accede, filtradas en SQL por el acceso efectivo. */
  listMine(page: KeysetRequest): Promise<KeysetPage<AccountView>> {
    const { uow, authorizer, accounts } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      return accounts.listVisiblePage(actor.id, page);
    });
  }

  /** Metadatos de todas las cuentas activas; no concede acceso a ninguna (ver las invariantes). */
  listInventory(page: KeysetRequest): Promise<KeysetPage<AccountView>> {
    const { uow, authorizer, accounts } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'vault.inventory.read' });
      return accounts.listInventoryPage(page);
    });
  }

  get(accountId: string): Promise<Result<AccountView, DomainError>> {
    const { uow, authorizer, accounts } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const level = await accounts.effectiveLevel(accountId, actor.id);
      if (level === null) return err(notFound());
      const account = await accounts.findById(accountId);
      if (account === null || account.status !== 'active') return err(notFound());
      return ok({ ...account, myLevel: level });
    });
  }

  create(input: CreateAccountInput): Promise<Result<AccountView, DomainError>> {
    const { context, uow, authorizer, accounts, ids, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'account.create' });
      const current = context.current();
      const actorId = this.requireActorId();

      if (!(await accounts.platformIsUsable(input.platformId))) {
        return err(
          new DomainError('ACCOUNT.PLATFORM_INVALID', 'Platform not found or not available'),
        );
      }
      const ownerGroupId = input.ownerGroupId ?? null;
      if (ownerGroupId !== null && !(await accounts.groupIsLive(ownerGroupId))) {
        return err(new DomainError('ACCOUNT.GROUP_INVALID', 'Group not found or archived'));
      }

      const account = await accounts.insert({
        id: ids.next(),
        platformId: input.platformId,
        displayName: input.displayName.trim(),
        handle: input.handle?.trim() ?? null,
        ownerGroupId,
        tags: uniqueTags(input.tags ?? []),
        createdBy: actorId,
      });
      await accounts.insertUserShare({
        id: ids.next(),
        accountId: account.id,
        userId: actorId,
        level: 'MANAGE',
        grantedBy: actorId,
      });
      await audit.record({
        action: 'account.created',
        actorId,
        targetType: 'account',
        targetId: account.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { platformId: account.platformId, hasOwnerGroup: ownerGroupId !== null },
      });
      return ok({ ...account, myLevel: 'MANAGE' });
    });
  }

  update(accountId: string, input: UpdateAccountInput): Promise<Result<AccountView, DomainError>> {
    const { context, uow, authorizer, accounts, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'account.update' });
      const current = context.current();
      const actorId = this.requireActorId();

      // Se bloquea la fila ANTES de leer el nivel: así una revocación o un archivado concurrente ya
      // confirmado se ve en el nivel, y nadie escribe con un nivel que venció mientras esperaba el bloqueo.
      const account = await accounts.findByIdForUpdate(accountId);
      if (account === null) return err(notFound());
      const level = await this.levelOrNotFound(account.id, actorId, 'account.update', 'EDIT');
      if (!level.ok) return level;
      if (account.status === 'archived') {
        return err(new DomainError('ACCOUNT.ARCHIVED', 'Account is archived'));
      }

      const ownerGroupId =
        input.ownerGroupId === undefined ? account.ownerGroupId : input.ownerGroupId;
      // Solo se valida el grupo cuando cambia: un grupo que se archivó después no frena otras ediciones.
      if (
        ownerGroupId !== null &&
        ownerGroupId !== account.ownerGroupId &&
        !(await accounts.groupIsLive(ownerGroupId))
      ) {
        return err(new DomainError('ACCOUNT.GROUP_INVALID', 'Group not found or archived'));
      }

      const edit = {
        displayName: input.displayName?.trim() ?? account.displayName,
        handle: input.handle === undefined ? account.handle : (input.handle?.trim() ?? null),
        ownerGroupId,
        tags: input.tags === undefined ? [...account.tags] : uniqueTags(input.tags),
      };
      const updated = await accounts.update(account.id, edit);
      await audit.record({
        action: 'account.updated',
        actorId,
        targetType: 'account',
        targetId: account.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { changedFields: changedFields(account, updated).join(',') },
      });
      return ok({ ...updated, myLevel: level.value });
    });
  }

  archive(accountId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, accounts, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: 'account.archive' });
      const current = context.current();
      const actorId = this.requireActorId();

      // Mismo orden que en `update`: bloquear la fila y después decidir con el nivel vigente.
      const account = await accounts.findByIdForUpdate(accountId);
      if (account === null) return err(notFound());
      const level = await this.levelOrNotFound(account.id, actorId, 'account.archive', 'MANAGE');
      if (!level.ok) return level;
      if (account.status === 'archived') return err(notFound());

      const { revokedShares } = await accounts.archive({
        accountId: account.id,
        at: clock.now(),
        revokedBy: actorId,
      });
      await audit.record({
        action: 'account.archived',
        actorId,
        targetType: 'account',
        targetId: account.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { revokedShares },
      });
      return ok(undefined);
    });
  }

  /**
   * Segunda llave: el nivel de acceso a la cuenta. Sin acceso no se distingue de una cuenta que no
   * existe; con acceso menor al requerido se niega con `AUTHZ.SHARE` y se audita la negación.
   */
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

/** Nombres de los campos que cambiaron, para el rastro de auditoría (nunca los valores). */
function changedFields(before: AccountRecord, after: AccountRecord): string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push('displayName');
  if (before.handle !== after.handle) changed.push('handle');
  if (before.ownerGroupId !== after.ownerGroupId) changed.push('ownerGroupId');
  if (before.tags.join('\u0000') !== after.tags.join('\u0000')) changed.push('tags');
  return changed;
}
