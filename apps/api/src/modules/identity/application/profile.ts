import type { Permission } from '@iam/contracts';

import { DomainError } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';
import { effectivePermissions } from '../../access/index.js';
import type { RoleRepository } from '../../access/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type { AuthenticatedPrincipal } from './session-service.js';

export interface Profile {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly rank: Rank;
    readonly locale: 'es-MX' | 'en-US';
    readonly timezone: string;
  };
  readonly permissions: readonly Permission[];
}

/** `/me`: quién es el usuario y qué puede hacer (la interfaz solo lo usa para mostrar u ocultar). */
export class GetProfile {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly directory: UserDirectory;
      readonly roles: RoleRepository;
    },
  ) {}

  execute(principal: AuthenticatedPrincipal): Promise<Profile> {
    const { uow, directory, roles } = this.deps;
    return uow.run(async () => {
      const user = await directory.findById(principal.userId);
      if (user === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
      const permissions = effectivePermissions(await roles.rolePermissionsOf(user.id), user.rank);
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          rank: user.rank,
          locale: user.locale,
          timezone: user.timezone,
        },
        permissions: [...permissions].sort(),
      };
    });
  }
}
