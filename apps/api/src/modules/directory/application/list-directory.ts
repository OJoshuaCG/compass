import type { DirectorySortField } from '@iam/contracts';

import { DomainError } from '../../../shared/kernel/index.js';
import type { RequestContextReader } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { DirectoryPage } from './ports/user-directory.js';
import type { UserDirectory } from './ports/user-directory.js';

export interface ListDirectoryQuery {
  readonly search?: string | undefined;
  readonly sort?: DirectorySortField | undefined;
  readonly dir?: 'asc' | 'desc' | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/**
 * Directorio visible (regla 11): cualquier usuario activo busca nombre y correo de los demás para
 * poder compartir. Detalles, roles y actividad requieren poder gestionarlos y no se exponen aquí.
 *
 * El estado del actor se comprueba aquí y no solo en la guarda de sesión: una ruta futura marcada como
 * pública o con sesión parcial no debe poder exponer nombres y correos (defensa en profundidad, TODO A3).
 */
export class ListDirectory {
  constructor(
    private readonly deps: {
      readonly directory: UserDirectory;
      readonly uow: UnitOfWork;
      readonly context: RequestContextReader;
    },
  ) {}

  execute(query: ListDirectoryQuery): Promise<DirectoryPage> {
    const { directory, uow, context } = this.deps;
    const search = query.search?.trim() ?? '';
    return uow.run(async () => {
      const actorId = context.current().actorId;
      const actor = actorId === null ? null : await directory.findById(actorId);
      if (actor?.status !== 'active') {
        throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      }
      return directory.list({
        search: search === '' ? null : search,
        sort: query.sort ?? 'displayName',
        dir: query.dir ?? 'asc',
        limit: query.limit,
        cursor: query.cursor ?? null,
      });
    });
  }
}
