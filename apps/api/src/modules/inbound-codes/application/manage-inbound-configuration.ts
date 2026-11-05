/**
 * Configuración de fuentes y vistas de códigos entrantes: alta, edición y archivo (ADR 0045, IC-5b).
 *
 * Invariantes de seguridad
 * - Dos llaves: el permiso `inbound.configure` y el nivel sobre el recurso concreto (EDIT para crear una
 *   vista y editar; MANAGE para archivar). Sin acceso al recurso se responde `NOT_FOUND`; con acceso
 *   insuficiente, `AUTHZ.SHARE`. En ambos casos la negación se audita.
 * - Quien crea una fuente o una vista recibe MANAGE sobre ella en la misma transacción; sin eso nadie
 *   podría compartirla ni archivarla.
 * - Una vista solo referencia plantillas vigentes del catálogo. Esta capa nunca crea ni cambia plantillas ni
 *   tipos: eso es de `platform.manage` (la clasificación sensible no la decide quien tiene EDIT).
 * - Ligar una fuente a una cuenta de la bóveda pide una cuenta activa y al menos USE sobre ella: una fuente
 *   no es una vía para colgar acceso a una cuenta que el propio actor no puede usar.
 * - Archivar revoca en la misma transacción las comparticiones de la fuente y de sus vistas (el conteo se
 *   audita). Archivar no borra nada.
 * - Se bloquea la fila antes de leer el nivel, para que un cambio concurrente ya confirmado se vea.
 * - Toda acción escribe su auditoría como último paso (ADR 0023).
 */
import type {
  CreateInboundSourceRequest,
  CreateInboundViewRequest,
  Permission,
  ShareLevel,
  UpdateInboundSourceRequest,
  UpdateInboundViewRequest,
} from '@iam/contracts';

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
import { levelSatisfies } from '../../vault/index.js';
import type {
  ConfigurableResource,
  InboundConfigurationRepository,
  SourceRecord,
  ViewRecord,
} from './ports/inbound-configuration-repository.js';

const CONFIGURE_PERMISSION: Permission = 'inbound.configure';
const EDIT_LEVEL: ShareLevel = 'EDIT';
const MANAGE_LEVEL: ShareLevel = 'MANAGE';
const ACCOUNT_USE_LEVEL: ShareLevel = 'USE';

const notFound = (what: string): DomainError => new DomainError('NOT_FOUND', `${what} not found`);

export interface ManageInboundConfigurationDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly configuration: InboundConfigurationRepository;
  readonly ids: IdGenerator;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export class ManageInboundConfiguration {
  constructor(private readonly deps: ManageInboundConfigurationDeps) {}

  createSource(input: CreateInboundSourceRequest): Promise<Result<SourceRecord, DomainError>> {
    const { context, uow, authorizer, configuration, ids, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const accountId = input.accountId ?? null;
      if (accountId !== null) {
        const link = await this.requireAccountToLink(accountId, actorId);
        if (!link.ok) return link;
      }

      const sourceId = ids.next();
      const inserted = await configuration.insertSource({
        id: sourceId,
        address: input.address,
        displayName: input.displayName,
        accountId,
        createdBy: actorId,
      });
      if (inserted === 'address_taken') {
        return err(
          new DomainError('INBOUND.SOURCE_ADDRESS_TAKEN', 'A source with that address exists'),
        );
      }
      await configuration.insertManageShare({
        id: ids.next(),
        resourceType: 'mail_source',
        resourceId: sourceId,
        userId: actorId,
      });
      const created = await configuration.findSource(sourceId);
      if (created === null) throw new Error('The source just inserted was not found');

      await audit.record({
        action: 'inbound.source_created',
        actorId,
        targetType: 'mail_source',
        targetId: sourceId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { channel: 'mail' },
      });
      return ok(created);
    });
  }

  updateSource(
    sourceId: string,
    input: UpdateInboundSourceRequest,
  ): Promise<Result<SourceRecord, DomainError>> {
    const { context, uow, authorizer, configuration, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const source = await configuration.findSourceForUpdate(sourceId);
      if (source === null) return this.denyUnknown('mail_source', sourceId, 'Inbound source');
      const level = await this.levelOrDeny('mail_source', source.id, actorId, EDIT_LEVEL);
      if (!level.ok) return level;

      const accountId = input.accountId === undefined ? source.accountId : input.accountId;
      // Solo se valida la cuenta cuando cambia: una cuenta archivada después no frena otras ediciones.
      if (accountId !== null && accountId !== source.accountId) {
        const link = await this.requireAccountToLink(accountId, actorId);
        if (!link.ok) return link;
      }

      const updated = await configuration.updateSource(source.id, {
        displayName: input.displayName ?? source.displayName,
        accountId,
      });
      await audit.record({
        action: 'inbound.source_updated',
        actorId,
        targetType: 'mail_source',
        targetId: source.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { changedFields: changedSourceFields(source, updated).join(',') },
      });
      return ok(updated);
    });
  }

  archiveSource(sourceId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, configuration, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const source = await configuration.findSourceForUpdate(sourceId);
      if (source === null) return this.denyUnknown('mail_source', sourceId, 'Inbound source');
      const level = await this.levelOrDeny('mail_source', source.id, actorId, MANAGE_LEVEL);
      if (!level.ok) return level;

      const { revokedShares } = await configuration.archiveSource(source.id, clock.now(), actorId);
      await audit.record({
        action: 'inbound.source_archived',
        actorId,
        targetType: 'mail_source',
        targetId: source.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { revokedShares },
      });
      return ok(undefined);
    });
  }

  createView(input: CreateInboundViewRequest): Promise<Result<ViewRecord, DomainError>> {
    const { context, uow, authorizer, configuration, ids, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const source = await configuration.findSourceForUpdate(input.sourceId);
      if (source === null) return this.denyUnknown('mail_source', input.sourceId, 'Inbound source');
      const level = await this.levelOrDeny('mail_source', source.id, actorId, EDIT_LEVEL);
      if (!level.ok) return level;

      const templateIds = [...new Set(input.templateIds)];
      if (!(await this.templatesAreLive(templateIds))) return err(templatesInvalid());

      const viewId = ids.next();
      const inserted = await configuration.insertView({
        id: viewId,
        sourceId: source.id,
        name: input.name,
        createdBy: actorId,
      });
      if (inserted === 'name_taken') return err(viewNameTaken());
      await configuration.replaceTemplates(viewId, templateIds);
      await configuration.insertManageShare({
        id: ids.next(),
        resourceType: 'mail_view',
        resourceId: viewId,
        userId: actorId,
      });
      const created = await configuration.findView(viewId);
      if (created === null) throw new Error('The view just inserted was not found');

      await audit.record({
        action: 'inbound.view_created',
        actorId,
        targetType: 'mail_view',
        targetId: viewId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { sourceId: source.id, templateCount: templateIds.length },
      });
      return ok(created);
    });
  }

  updateView(
    viewId: string,
    input: UpdateInboundViewRequest,
  ): Promise<Result<ViewRecord, DomainError>> {
    const { context, uow, authorizer, configuration, audit } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const view = await configuration.findViewForUpdate(viewId);
      if (view === null) return this.denyUnknown('mail_view', viewId, 'Inbound view');
      const level = await this.levelOrDeny('mail_view', view.id, actorId, EDIT_LEVEL);
      if (!level.ok) return level;

      // Todo lo que puede fallar con un `err` va ANTES de la primera escritura: la unidad de trabajo confirma
      // la transacción con cualquier retorno que no lance, así que un `err` tras escribir dejaría cambios a medias.
      const templateIds = input.templateIds === undefined ? null : [...new Set(input.templateIds)];
      if (templateIds !== null && !(await this.templatesAreLive(templateIds))) {
        return err(templatesInvalid());
      }
      if (input.name !== undefined && input.name !== view.name) {
        const renamed = await configuration.renameView(view.id, input.name);
        if (renamed === 'name_taken') return err(viewNameTaken());
      }
      let addedCount = 0;
      let removedCount = 0;
      if (templateIds !== null) {
        const change = await configuration.replaceTemplates(view.id, templateIds);
        addedCount = change.added;
        removedCount = change.removed;
      }
      const updated = await configuration.findView(view.id);
      if (updated === null) throw new Error('The view just updated was not found');

      await audit.record({
        action: 'inbound.view_updated',
        actorId,
        targetType: 'mail_view',
        targetId: view.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { sourceId: view.sourceId, addedCount, removedCount },
      });
      return ok(updated);
    });
  }

  archiveView(viewId: string): Promise<Result<void, DomainError>> {
    const { context, uow, authorizer, configuration, audit, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const current = context.current();
      const actorId = this.requireActorId();

      const view = await configuration.findViewForUpdate(viewId);
      if (view === null) return this.denyUnknown('mail_view', viewId, 'Inbound view');
      const level = await this.levelOrDeny('mail_view', view.id, actorId, MANAGE_LEVEL);
      if (!level.ok) return level;

      const { revokedShares } = await configuration.archiveView(view.id, clock.now(), actorId);
      await audit.record({
        action: 'inbound.view_archived',
        actorId,
        targetType: 'mail_view',
        targetId: view.id,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: current.requestId,
        metadata: { sourceId: view.sourceId, revokedShares },
      });
      return ok(undefined);
    });
  }

  private async templatesAreLive(templateIds: readonly string[]): Promise<boolean> {
    return (await this.deps.configuration.countLiveTemplates(templateIds)) === templateIds.length;
  }

  /**
   * Una cuenta que no existe, está archivada o sobre la que el actor no llega a USE se responde igual
   * (`INBOUND.ACCOUNT_INVALID`): no se revela qué cuentas existen. La cuenta se bloquea antes de leer el
   * nivel, para que revocar el acceso del actor no pueda colarse entre la lectura y el cambio.
   */
  private async requireAccountToLink(
    accountId: string,
    actorId: UserId,
  ): Promise<Result<void, DomainError>> {
    const { configuration, authorizer } = this.deps;
    await configuration.lockAccountForShare(accountId);
    // El estado se lee DESPUÉS del bloqueo: un archivo concurrente ya confirmado se ve aquí.
    const isActive = await configuration.accountIsActive(accountId);
    const level = isActive ? await configuration.accountLevel(accountId, actorId) : null;
    // Cuenta inexistente, archivada o sin USE: misma respuesta y misma auditoría, sin oráculo de existencia.
    if (!isActive || level === null || !levelSatisfies(level, ACCOUNT_USE_LEVEL)) {
      await authorizer.auditDenial({
        code: 'AUTHZ.SHARE',
        permission: CONFIGURE_PERMISSION,
        targetAccountId: accountId,
      });
      return err(accountInvalid());
    }
    return ok(undefined);
  }

  /** Segunda llave: el nivel sobre la fuente o la vista. Sin nivel `NOT_FOUND`; con menos, `AUTHZ.SHARE`. */
  private async levelOrDeny(
    resourceType: ConfigurableResource,
    resourceId: string,
    actorId: UserId,
    required: ShareLevel,
  ): Promise<Result<ShareLevel, DomainError>> {
    const level = await this.deps.configuration.resourceLevel(resourceType, resourceId, actorId);
    if (level === null) {
      return this.denyUnknown(
        resourceType,
        resourceId,
        resourceType === 'mail_source' ? 'Inbound source' : 'Inbound view',
      );
    }
    if (!levelSatisfies(level, required)) {
      await this.auditDenial(resourceType, resourceId);
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this inbound resource'));
    }
    return ok(level);
  }

  /** Recurso inexistente, archivado o sin nivel se responden igual, y el intento se audita. */
  private async denyUnknown(
    resourceType: ConfigurableResource,
    resourceId: string,
    what: string,
  ): Promise<Result<never, DomainError>> {
    await this.auditDenial(resourceType, resourceId);
    return err(notFound(what));
  }

  private async auditDenial(resourceType: ConfigurableResource, resourceId: string): Promise<void> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.SHARE',
      permission: CONFIGURE_PERMISSION,
      ...(resourceType === 'mail_source'
        ? { targetSourceId: resourceId }
        : { targetViewId: resourceId }),
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}

const templatesInvalid = (): DomainError =>
  new DomainError('INBOUND.TEMPLATE_INVALID', 'Some template does not exist or is archived');
const viewNameTaken = (): DomainError =>
  new DomainError('INBOUND.VIEW_NAME_TAKEN', 'A view with that name exists on this source');
const accountInvalid = (): DomainError =>
  new DomainError('INBOUND.ACCOUNT_INVALID', 'Account not found, archived or not usable');

function changedSourceFields(before: SourceRecord, after: SourceRecord): string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push('displayName');
  if (before.accountId !== after.accountId) changed.push('accountId');
  return changed;
}
