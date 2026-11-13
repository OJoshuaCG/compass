/**
 * Vistas guardadas del listado «Mis cuentas»: ver, guardar y borrar las propias.
 *
 * Invariantes de seguridad
 * - Solo con una sesión de persona activa. Solo se listan y borran vistas propias; una ajena responde
 *   `NOT_FOUND`, igual que si no existiera.
 * - Una vista guarda criterios de búsqueda, no resultados: al aplicarla, el listado vuelve a pasar por el
 *   acceso efectivo, así que una vista nunca concede ni revela acceso.
 * - Máximo `MAX_SAVED_VIEWS` por persona y nombre único por persona sin distinguir mayúsculas.
 * - Son preferencias personales sin datos sensibles de la bóveda: no escriben auditoría.
 */
import { MAX_SAVED_VIEWS } from '@iam/contracts';
import type { AccountListFilter } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { IdGenerator, Result } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { SavedViewRecord, SavedViewRepository } from './ports/saved-view-repository.js';

export interface ManageSavedViewsDeps {
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly savedViews: SavedViewRepository;
  readonly ids: IdGenerator;
}

export interface CreateSavedViewInput {
  readonly name: string;
  readonly text?: string | undefined;
  readonly filter?: AccountListFilter | undefined;
}

export class ManageSavedViews {
  constructor(private readonly deps: ManageSavedViewsDeps) {}

  list(): Promise<readonly SavedViewRecord[]> {
    const { uow, authorizer, savedViews } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      return savedViews.listByUser(actor.id);
    });
  }

  create(input: CreateSavedViewInput): Promise<Result<SavedViewRecord, DomainError>> {
    const { uow, authorizer, savedViews, ids } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      // Sin este candado, dos altas simultáneas leen el mismo conteo y rebasan el máximo.
      await savedViews.lockUser(actor.id);
      const existingCount = await savedViews.countByUser(actor.id);
      if (existingCount >= MAX_SAVED_VIEWS) {
        return err(
          new DomainError('SAVED_VIEW.LIMIT_REACHED', 'The saved view limit was reached', {
            limit: MAX_SAVED_VIEWS,
          }),
        );
      }
      const id = ids.next();
      const inserted = await savedViews.insert({
        id,
        userId: actor.id,
        name: input.name,
        searchText: input.text ?? null,
        quickFilter: input.filter ?? null,
      });
      if (!inserted) {
        return err(new DomainError('SAVED_VIEW.NAME_TAKEN', 'A saved view with that name exists'));
      }
      const created = (await savedViews.listByUser(actor.id)).find((view) => view.id === id);
      if (created === undefined) {
        throw new Error('The saved view was not readable after being inserted');
      }
      return ok(created);
    });
  }

  remove(viewId: string): Promise<Result<void, DomainError>> {
    const { uow, authorizer, savedViews } = this.deps;
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const deleted = await savedViews.deleteOwned(actor.id, viewId);
      if (!deleted) {
        return err(new DomainError('SAVED_VIEW.NOT_FOUND', 'Saved view not found'));
      }
      return ok(undefined);
    });
  }
}
