import type { OrganizationId, Rank, UserId } from '../../../shared/kernel/index.js';

export type UserStatus = 'invited' | 'active' | 'suspended' | 'deactivated';

/** Lo mínimo de un usuario que necesitan las reglas de jerarquía. */
export interface UserSubject {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly rank: Rank;
  readonly status: UserStatus;
}

export interface UserRecord extends UserSubject {
  readonly email: string;
  readonly displayName: string;
  readonly managedBy: UserId | null;
  readonly createdBy: UserId | null;
  readonly locale: 'es-MX' | 'en-US';
  readonly timezone: string;
}
