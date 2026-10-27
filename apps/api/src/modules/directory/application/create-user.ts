/**
 * Invariantes de seguridad
 * - Un usuario solo nace con un responsable activo de rango menor (más autoridad).
 * - La Raíz no se crea aquí: nace con la organización (índice único de una sola Raíz activa).
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type {
  IdGenerator,
  OrganizationId,
  Rank,
  Result,
  UserId,
} from '../../../shared/kernel/index.js';
import { canCreateRank } from '../domain/management-policy.js';
import type { UserRecord } from '../domain/user.js';
import type { UserDirectory } from './ports/user-directory.js';

export interface CreateUserCommand {
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly displayName: string;
  readonly rank: Rank;
  readonly managedBy: UserId;
  readonly createdBy: UserId;
  readonly locale?: 'es-MX' | 'en-US';
}

export class CreateUser {
  constructor(
    private readonly deps: { readonly directory: UserDirectory; readonly ids: IdGenerator },
  ) {}

  /** Crea el usuario en estado `invited`: pasa a `active` al registrar su segundo factor. */
  async execute(command: CreateUserCommand): Promise<Result<UserRecord, DomainError>> {
    const { directory, ids } = this.deps;
    const manager = await directory.findById(command.managedBy);
    if (manager?.status !== 'active') {
      return err(new DomainError('INVITATION.INVALID', 'The responsible user is not available'));
    }
    if (!canCreateRank(manager.rank, command.rank)) {
      return err(
        new DomainError(
          'AUTHZ.CREATION_NOT_ALLOWED',
          'The responsible user cannot manage that rank',
        ),
      );
    }
    const user: UserRecord = {
      id: ids.next() as UserId,
      organizationId: command.organizationId,
      email: command.email,
      displayName: command.displayName,
      rank: command.rank,
      status: 'invited',
      managedBy: command.managedBy,
      createdBy: command.createdBy,
      locale: command.locale ?? 'es-MX',
      timezone: 'UTC',
    };
    const outcome = await directory.insert(user);
    if (outcome === 'email_taken') {
      return err(new DomainError('INVITATION.CONFLICT', 'A user with that email already exists'));
    }
    return ok(user);
  }
}
