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

import { DomainError, RANK, ok } from '../../../shared/kernel/index.js';
import type { RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { UserDirectory } from '../../directory/index.js';
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
  readonly users: Pick<UserDirectory, 'findById'>;
}

/** Vista legible más si la persona puede pedir borrar o ver correo de su fuente (la misma regla que aplica el servidor). */
export type ReadableViewEntry = ReadableViewSummary & { readonly canManageMail: boolean };

export class ListInboundDirectory {
  constructor(private readonly deps: ListInboundDirectoryDeps) {}

  /** Vistas que la persona puede leer, con su nivel. */
  listViews(): Promise<Result<readonly ReadableViewEntry[], DomainError>> {
    const { uow, authorizer, directory, users } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: READ_PERMISSION });
      const actorId = this.requireActorId();
      const views = await directory.listReadableViews(actorId, MAX_INBOUND_LISTING);
      // Solo comodidad para la interfaz: borrar o ver correo lo decide y audita `RequestInboundMailDelete`
      // (Administrador o quien dio de alta la fuente); aquí se anticipa para no ofrecer lo que será negado.
      const actor = await users.findById(actorId);
      const isAdministrator = actor !== null && actor.rank <= RANK.ADMINISTRATOR;
      return ok(
        views.map((view) => ({
          ...view,
          canManageMail: isAdministrator || view.sourceCreatedByMe,
        })),
      );
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
