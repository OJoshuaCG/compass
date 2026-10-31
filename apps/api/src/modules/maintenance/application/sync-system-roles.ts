/**
 * Sincroniza los roles de sistema de las organizaciones ya creadas con las plantillas vigentes (B5a).
 *
 * Invariantes de seguridad
 * - Solo toca roles con `is_system` que tengan una plantilla del mismo nombre; nunca un rol personalizado.
 * - Compara permisos como conjuntos y solo escribe si difieren: ejecutarlo dos veces no cambia nada.
 * - Cada rol modificado se audita (`role.system_synced`, sin actor: es una acción del sistema) en la
 *   MISMA transacción del cambio; si la auditoría falla, el cambio de esa organización se revierte.
 * - Una transacción por organización: un fallo en una no detiene a las demás.
 */
import { DomainError } from '../../../shared/kernel/index.js';
import type { IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { OrganizationLister } from './ports/purge-ports.js';
import type { SystemRoleStore } from './ports/system-role-ports.js';
import { describeFailure } from './purge-expired-ephemeral.js';
import type { OrganizationFailure } from './purge-expired-ephemeral.js';

/**
 * La auditoría rechaza valores de texto de más de 256 caracteres. Una diferencia grande (por ejemplo un
 * rol al que una plantilla nueva le agrega muchos permisos) haría fallar siempre a esa organización,
 * así que la lista se recorta con una marca; el detalle completo se reconstruye con la plantilla y la
 * versión del rol.
 */
const AUDIT_NAMES_MAX_LENGTH = 256;
const AUDIT_NAMES_TRUNCATION_MARK = '...';

export function joinForAudit(permissions: readonly string[]): string {
  const joined = permissions.join(',');
  if (joined.length <= AUDIT_NAMES_MAX_LENGTH) return joined;
  return (
    joined.slice(0, AUDIT_NAMES_MAX_LENGTH - AUDIT_NAMES_TRUNCATION_MARK.length) +
    AUDIT_NAMES_TRUNCATION_MARK
  );
}

export interface SyncSystemRolesSummary {
  readonly organizations: number;
  /** Roles de sistema cuyos permisos se corrigieron. */
  readonly rolesUpdated: number;
  /** Organizaciones cuya sincronización falló y se revirtió; el resto se procesó igual. */
  readonly failedOrganizations: readonly OrganizationFailure[];
}

interface Dependencies {
  readonly organizations: OrganizationLister;
  readonly store: SystemRoleStore;
  readonly audit: AuditLog;
  readonly scope: TenantScope;
  readonly ids: IdGenerator;
  /** Plantillas vigentes (`SYSTEM_ROLES`); se inyectan para poder probar con plantillas ficticias. */
  readonly templates: readonly { readonly name: string; readonly permissions: readonly string[] }[];
}

export class SyncSystemRoles {
  constructor(private readonly deps: Dependencies) {}

  async execute(): Promise<SyncSystemRolesSummary> {
    const organizationIds = await this.deps.organizations.listIds();
    let rolesUpdated = 0;
    const failedOrganizations: OrganizationFailure[] = [];

    for (const organizationId of organizationIds) {
      try {
        rolesUpdated += await this.syncOrganization(organizationId);
      } catch (error) {
        failedOrganizations.push({ organizationId, reason: describeFailure(error) });
      }
    }

    return { organizations: organizationIds.length, rolesUpdated, failedOrganizations };
  }

  private syncOrganization(organizationId: OrganizationId): Promise<number> {
    const { scope, ids, store, audit, templates } = this.deps;
    const requestId = ids.next();
    return scope.runAs({ organizationId, actorId: null, requestId }, async () => {
      let updated = 0;
      for (const role of await store.listLiveSystemRoles()) {
        const template = templates.find((candidate) => candidate.name === role.name);
        if (template === undefined) continue;

        const stored = new Set(role.permissions);
        const wanted = new Set<string>(template.permissions);
        const removed = [...stored].filter((permission) => !wanted.has(permission)).sort();
        const added = [...wanted].filter((permission) => !stored.has(permission)).sort();
        if (removed.length === 0 && added.length === 0) continue;

        const replaced = await store.replacePermissions(role.id, template.permissions);
        if (!replaced) continue;

        const recorded = await audit.record({
          action: 'role.system_synced',
          actorId: null,
          targetType: 'role',
          targetId: role.id,
          outcome: 'success',
          reasonCode: null,
          ip: null,
          requestId,
          metadata: {
            roleName: role.name,
            removed: joinForAudit(removed),
            added: joinForAudit(added),
          },
        });
        // Un cambio de permisos sin rastro no se admite: se revierte la organización completa.
        if (!recorded.ok)
          throw new DomainError(recorded.error.code, 'System role sync not audited');
        updated += 1;
      }
      return updated;
    });
  }
}
