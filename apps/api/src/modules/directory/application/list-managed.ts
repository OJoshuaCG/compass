import type { DirectorySortField, Permission } from '@iam/contracts';

import { RANK } from '../../../shared/kernel/index.js';
import type { UserId } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { canManage } from '../domain/management-policy.js';
import type { AssignedRoleNamesReader } from './ports/assigned-role-names-reader.js';
import type { ManagedRow, UserDirectory } from './ports/user-directory.js';
import type { ListDirectoryQuery, MemberAuthorizer } from './list-directory.js';

export type ListManagedQuery = ListDirectoryQuery & {
  readonly sort?: DirectorySortField | undefined;
};

/** Permisos efectivos de quien consulta, sin decidir ni auditar (los da el motor de autorización). */
export interface ManagedViewAuthorizer extends MemberAuthorizer {
  actorPermissions(): Promise<ReadonlySet<Permission>>;
}

export interface ManagedViewRow extends ManagedRow {
  /**
   * Nombres de los roles vigentes, o `null` si quien consulta no podría verlos uno por uno. Distinguir
   * `null` de una lista vacía evita que la pantalla diga "sin roles" cuando en realidad no los ve.
   */
  readonly roleNames: readonly string[] | null;
}

export interface ManagedViewPage {
  readonly rows: readonly ManagedViewRow[];
  readonly nextCursor: string | null;
}

/** Mismo permiso que exige ver los roles de una persona (`ManagePersonRoles.view`). */
const VIEW_ROLES_PERMISSION = 'user.invite' satisfies Permission;

/**
 * Vista de gestión: las personas bajo la responsabilidad de quien consulta (su subárbol, o toda la
 * organización para la Raíz). Quien no gestiona a nadie recibe una página vacía, no un error: la
 * pantalla decide si mostrar la pestaña.
 *
 * Invariantes de seguridad
 * - El alcance lo fija el motor: actor activo de la organización del contexto y su subárbol.
 * - Los roles de una fila solo se incluyen si quien consulta podría verlos uno por uno: tiene
 *   `user.invite` y gestiona a esa persona (la misma regla que `ManagePersonRoles.view`). Se resuelve
 *   con los permisos efectivos, sin auditar una negación por fila; si no aplica, la fila lleva `null`.
 * - El rol personal (permisos especiales) nunca se lista: lo excluye el lector.
 */
export class ListManaged {
  constructor(
    private readonly deps: {
      readonly directory: UserDirectory;
      readonly uow: UnitOfWork;
      readonly authorizer: ManagedViewAuthorizer;
      readonly roleNames: AssignedRoleNamesReader;
    },
  ) {}

  execute(query: ListManagedQuery): Promise<ManagedViewPage> {
    const { directory, uow, authorizer, roleNames } = this.deps;
    const search = query.search?.trim() ?? '';
    return uow.run(async () => {
      const actor = await authorizer.requireActiveMember();
      const page = await directory.listManaged(
        { id: actor.id, isRoot: actor.rank === RANK.ROOT },
        {
          search: search === '' ? null : search,
          sort: query.sort ?? 'displayName',
          dir: query.dir ?? 'asc',
          limit: query.limit,
          cursor: query.cursor ?? null,
        },
      );

      const canViewRoles = (await authorizer.actorPermissions()).has(VIEW_ROLES_PERMISSION);
      // El subárbol ya lo acotó la consulta; `canManage` vuelve a exigir rango y estado del actor. Las
      // filas son de la organización del actor (RLS y `requireActiveMember`), de ahí su organización.
      const visible = new Set<UserId>(
        canViewRoles
          ? page.rows
              .filter((row) =>
                canManage(actor, { ...row, organizationId: actor.organizationId }, true),
              )
              .map((row) => row.id)
          : [],
      );
      const names =
        visible.size === 0
          ? new Map<UserId, readonly string[]>()
          : await roleNames.listLiveRoleNames([...visible]);

      return {
        rows: page.rows.map((row) => ({
          ...row,
          roleNames: visible.has(row.id) ? (names.get(row.id) ?? []) : null,
        })),
        nextCursor: page.nextCursor,
      };
    });
  }
}
