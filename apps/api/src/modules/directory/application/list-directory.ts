import type { DirectorySortField } from '@iam/contracts';

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
 */
export class ListDirectory {
  constructor(
    private readonly deps: { readonly directory: UserDirectory; readonly uow: UnitOfWork },
  ) {}

  execute(query: ListDirectoryQuery): Promise<DirectoryPage> {
    const search = query.search?.trim() ?? '';
    return this.deps.uow.run(() =>
      this.deps.directory.list({
        search: search === '' ? null : search,
        sort: query.sort ?? 'displayName',
        dir: query.dir ?? 'asc',
        limit: query.limit,
        cursor: query.cursor ?? null,
      }),
    );
  }
}
