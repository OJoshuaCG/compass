/**
 * Paneles de salud de credenciales por grupo y por organización (permiso `credential.view_health`).
 *
 * Invariantes de seguridad
 * - El permiso lo decide el motor de autorización; además, la organización entera exige rango de
 *   Administrador o superior y un grupo exige poder administrarlo (rango de Administrador o superior, o
 *   gestor del grupo con rango de Líder o superior): el mismo alcance que ya tiene sobre sus miembros.
 * - Quien no cumple recibe `AUTHZ.PERMISSION` (organización) o `GROUP.NOT_FOUND` (grupo, sin revelar si
 *   existe) y la negación se audita.
 * - La reutilización de contraseña se mide contra toda la organización, también en el panel de un grupo: es
 *   una propiedad de la organización y solo se expone como señal, nunca qué cuentas la comparten.
 * - Solo devuelve conteos: ni nombres de cuentas o etiquetas, ni secretos, ni huellas. Las señales son
 *   informativas y nunca bloquean nada.
 */
import type { Permission } from '@iam/contracts';

import { DomainError, RANK, err, ok } from '../../../shared/kernel/index.js';
import type { Result } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import { canManageGroupMembers } from '../../directory/index.js';
import type { GroupStore } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import {
  evaluateCredentialHealth,
  summarizeCredentialHealth,
} from '../domain/credential-health.js';
import type {
  CredentialHealthFacts,
  CredentialHealthSummary,
} from '../domain/credential-health.js';
import type { CredentialHealthReader } from './ports/credential-health-reader.js';

const VIEW_HEALTH_PERMISSION: Permission = 'credential.view_health';
/** Rango máximo (inclusive) que ve la salud de toda la organización: Raíz y Administradores. */
const MAX_RANK_WITH_ORGANIZATION_HEALTH = RANK.ADMINISTRATOR;

export interface GetCredentialHealthSummaryDeps {
  readonly uow: UnitOfWork;
  readonly authorizer: Pick<Authorizer, 'require' | 'requireActiveMember' | 'auditDenial'>;
  readonly groups: Pick<GroupStore, 'findLive' | 'roleOf'>;
  readonly health: CredentialHealthReader;
  readonly clock: { now(): Date };
}

type Outcome = Result<CredentialHealthSummary, DomainError>;

export class GetCredentialHealthSummary {
  constructor(private readonly deps: GetCredentialHealthSummaryDeps) {}

  forOrganization(): Promise<Outcome> {
    const { uow, authorizer, health } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: VIEW_HEALTH_PERMISSION });
      const actor = await authorizer.requireActiveMember();
      if (actor.rank > MAX_RANK_WITH_ORGANIZATION_HEALTH) {
        await authorizer.auditDenial({
          code: 'AUTHZ.PERMISSION',
          permission: VIEW_HEALTH_PERMISSION,
        });
        return err(new DomainError('AUTHZ.PERMISSION', 'Action not allowed'));
      }
      return ok(this.summarize(await health.factsByOrganization()));
    });
  }

  forGroup(groupId: string): Promise<Outcome> {
    const { uow, authorizer, groups, health, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: VIEW_HEALTH_PERMISSION });
      const actor = await authorizer.requireActiveMember();
      const group = await groups.findLive(groupId);
      if (group === null) {
        // Se audita igual que un grupo que no se puede ver: la respuesta es idéntica y la huella en la
        // auditoría también.
        await this.auditGroupDenial();
        return this.groupNotFound();
      }

      const roleInGroup = await groups.roleOf(groupId, actor.id);
      if (!canManageGroupMembers(actor.rank, roleInGroup)) {
        await this.auditGroupDenial();
        return this.groupNotFound();
      }
      return ok(this.summarize(await health.factsByGroup(groupId, clock.now())));
    });
  }

  private summarize(facts: readonly CredentialHealthFacts[]): CredentialHealthSummary {
    const now = this.deps.clock.now();
    return summarizeCredentialHealth(facts.map((entry) => evaluateCredentialHealth(entry, now)));
  }

  private auditGroupDenial(): Promise<void> {
    return this.deps.authorizer.auditDenial({
      code: 'AUTHZ.PERMISSION',
      permission: VIEW_HEALTH_PERMISSION,
    });
  }

  private groupNotFound(): Outcome {
    return err(new DomainError('GROUP.NOT_FOUND', 'Group not found'));
  }
}
