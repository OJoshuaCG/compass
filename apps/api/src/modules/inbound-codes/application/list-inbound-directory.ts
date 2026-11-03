/**
 * Listados de fuentes y vistas de códigos entrantes para la interfaz (ADR 0045, IC-6a).
 *
 * Invariantes de seguridad
 * - Dos llaves, como el resto de la bóveda: el permiso del catálogo (`inbound.read_codes` para las vistas,
 *   `inbound.configure` para las fuentes) lo decide el motor de autorización, y solo se lista lo que la
 *   persona alcanza por acceso efectivo. Sin nivel, el recurso no aparece.
 * - Las vistas listadas son las que hoy se pueden leer; el listado no lleva la dirección de la fuente ni la
 *   cuenta ligada, porque quien solo tiene USE ve códigos, no la configuración.
 * - Listar no entrega secretos ni códigos y no se audita: la lectura de cada código sí deja su auditoría.
 * - Las vistas configurables y las plantillas piden `inbound.configure`: sirven para armar y editar vistas,
 *   y editar sigue exigiendo EDIT o MANAGE sobre la vista en `ManageInboundConfiguration`.
 */
import { MAX_INBOUND_LISTING } from '@iam/contracts';
import type { Permission } from '@iam/contracts';

import { DomainError, ok } from '../../../shared/kernel/index.js';
import type { RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type {
  ConfigurableSourceSummary,
  ConfigurableViewSummary,
  InboundDirectory,
  ReadableViewSummary,
  TemplateSummary,
} from './ports/inbound-directory.js';

const READ_PERMISSION: Permission = 'inbound.read_codes';
const CONFIGURE_PERMISSION: Permission = 'inbound.configure';

export interface ListInboundDirectoryDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: InboundDirectory;
}

export class ListInboundDirectory {
  constructor(private readonly deps: ListInboundDirectoryDeps) {}

  /** Vistas que la persona puede leer, con su nivel. */
  listViews(): Promise<Result<readonly ReadableViewSummary[], DomainError>> {
    const { uow, authorizer, directory } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: READ_PERMISSION });
      const actorId = this.requireActorId();
      return ok(await directory.listReadableViews(actorId, MAX_INBOUND_LISTING));
    });
  }

  /** Fuentes no archivadas sobre las que la persona tiene un nivel, con ese nivel. */
  listSources(): Promise<Result<readonly ConfigurableSourceSummary[], DomainError>> {
    const { uow, authorizer, directory } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const actorId = this.requireActorId();
      return ok(await directory.listConfigurableSources(actorId, MAX_INBOUND_LISTING));
    });
  }

  /** Vistas no archivadas de fuentes no archivadas sobre las que la persona tiene un nivel, con su nivel. */
  listConfigurableViews(): Promise<Result<readonly ConfigurableViewSummary[], DomainError>> {
    const { uow, authorizer, directory } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      const actorId = this.requireActorId();
      return ok(await directory.listConfigurableViews(actorId, MAX_INBOUND_LISTING));
    });
  }

  /** Plantillas vigentes de la organización que una vista puede referenciar. */
  listTemplates(): Promise<Result<readonly TemplateSummary[], DomainError>> {
    const { uow, authorizer, directory } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: CONFIGURE_PERMISSION });
      this.requireActorId();
      return ok(await directory.listLiveTemplates(MAX_INBOUND_LISTING));
    });
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}
