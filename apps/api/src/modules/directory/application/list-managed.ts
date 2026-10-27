import type { DirectorySortField } from '@iam/contracts';

import { DomainError, RANK } from '../../../shared/kernel/index.js';
import type { RequestContextReader } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { ManagedPage, UserDirectory } from './ports/user-directory.js';
import type { ListDirectoryQuery } from './list-directory.js';

export type ListManagedQuery = ListDirectoryQuery & {
  readonly sort?: DirectorySortField | undefined;
};

/**
 * Vista de gestión: las personas bajo la responsabilidad de quien consulta (su subárbol, o toda la
 * organización para la Raíz). Quien no gestiona a nadie recibe una página vacía, no un error: la
 * pantalla decide si mostrar la pestaña.
 */
export class ListManaged {
  constructor(
    private readonly deps: {
      readonly directory: UserDirectory;
      readonly uow: UnitOfWork;
      readonly context: RequestContextReader;
    },
  ) {}

  execute(query: ListManagedQuery): Promise<ManagedPage> {
    const { directory, uow, context } = this.deps;
    const search = query.search?.trim() ?? '';
    return uow.run(async () => {
      const actorId = context.current().actorId;
      const actor = actorId === null ? null : await directory.findById(actorId);
      if (actor?.status !== 'active') {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }
      return directory.listManaged(
        { id: actor.id, isRoot: actor.rank === RANK.ROOT },
        {
          search: search === '' ? null : search,
          sort: query.sort ?? 'displayName',
          dir: query.dir ?? 'asc',
          limit: query.limit,
          cursor: query.cursor ?? null,
        },
      );
    });
  }
}
