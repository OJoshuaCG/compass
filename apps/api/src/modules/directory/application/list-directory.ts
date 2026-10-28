import type { DirectorySortField } from '@iam/contracts';

import type { UnitOfWork } from '../../organization/index.js';
import type { UserRecord } from '../domain/user.js';
import type { DirectoryPage } from './ports/user-directory.js';
import type { UserDirectory } from './ports/user-directory.js';

/** Lo que las consultas del directorio necesitan del motor de autorización (módulo de acceso). */
export interface MemberAuthorizer {
  /** Devuelve al actor activo de la organización del contexto o lanza la negación ya auditada. */
  requireActiveMember(): Promise<UserRecord>;
}

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
 * Quién puede consultar lo decide el motor de autorización (F6): exige una persona activa de la
 * organización del contexto y audita la negación. Una ruta futura marcada como pública o con sesión
 * parcial no puede exponer nombres y correos (defensa en profundidad, TODO A3).
 */
export class ListDirectory {
  constructor(
    private readonly deps: {
      readonly directory: UserDirectory;
      readonly uow: UnitOfWork;
      readonly authorizer: MemberAuthorizer;
    },
  ) {}

  execute(query: ListDirectoryQuery): Promise<DirectoryPage> {
    const { directory, uow, authorizer } = this.deps;
    const search = query.search?.trim() ?? '';
    return uow.run(async () => {
      await authorizer.requireActiveMember();
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
