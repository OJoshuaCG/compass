import type { DirectorySortField } from '@iam/contracts';

import type { OrganizationId, Rank, UserId } from '../../../../shared/kernel/index.js';
import type { UserRecord, UserStatus } from '../../domain/user.js';

export interface NewUser {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: string;
  readonly displayName: string;
  readonly rank: Rank;
  readonly managedBy: UserId | null;
  readonly createdBy: UserId | null;
  readonly status: UserStatus;
  readonly locale: 'es-MX' | 'en-US';
  readonly timezone: string;
}

export interface DirectoryQuery {
  readonly search: string | null;
  readonly sort: DirectorySortField;
  readonly dir: 'asc' | 'desc';
  readonly limit: number;
  readonly cursor: string | null;
}

export interface DirectoryRow {
  readonly id: UserId;
  readonly displayName: string;
  readonly email: string;
  readonly rank: Rank;
}

export interface DirectoryPage {
  readonly rows: readonly DirectoryRow[];
  readonly nextCursor: string | null;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface UserDirectory {
  findById(id: UserId): Promise<UserRecord | null>;
  existsByEmail(email: string): Promise<boolean>;
  /** Devuelve `email_taken` si el correo ya existe (es único en toda la plataforma). */
  insert(user: NewUser): Promise<'inserted' | 'email_taken'>;
  setStatus(id: UserId, status: UserStatus): Promise<void>;
  /** ¿`userId` está en el subárbol de gestión de `managerId` (su cadena de responsables llega a él)? */
  isInSubtree(managerId: UserId, userId: UserId): Promise<boolean>;
  hasReports(userId: UserId): Promise<boolean>;
  /** Directorio visible: usuarios activos, solo nombre, correo y rango. */
  list(query: DirectoryQuery): Promise<DirectoryPage>;
}
