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

/** Fila de la vista de gestión: además de lo visible, estado y responsable. */
export interface ManagedRow extends DirectoryRow {
  readonly status: UserStatus;
  readonly managedBy: UserId | null;
}

export interface ManagedPage {
  readonly rows: readonly ManagedRow[];
  readonly nextCursor: string | null;
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
  /**
   * Serializa las mutaciones de jerarquía de la organización hasta el fin de la transacción: las
   * reglas (rango, responsable, subordinados) se comprueban con lecturas y no deben cambiar debajo.
   */
  lockHierarchy(): Promise<void>;
  setRank(id: UserId, rank: Rank): Promise<void>;
  setManager(id: UserId, managerId: UserId): Promise<void>;
  /** Pasa a `toManagerId` a todos los subordinados vigentes (no dados de baja) de `fromManagerId`. */
  reassignReports(fromManagerId: UserId, toManagerId: UserId): Promise<number>;
  /**
   * Personas que `actor` gestiona (cualquier estado): su subárbol, o toda la organización si es la
   * Raíz. Nunca incluye al propio actor.
   */
  listManaged(
    actor: { readonly id: UserId; readonly isRoot: boolean },
    query: DirectoryQuery,
  ): Promise<ManagedPage>;
  /**
   * Cuántas personas ACTIVAS tienen exactamente ese rango. Suspendidas, invitadas y dadas de baja no
   * cuentan. Debe llamarse bajo `lockHierarchy` para que el conteo no cambie antes de escribir.
   */
  countActiveByRank(rank: Rank): Promise<number>;
  /** Correo e idioma de los Administradores activos (rango 1): destinatarios de las alertas críticas. */
  listAdministratorContacts(): Promise<
    readonly { readonly email: string; readonly locale: 'es-MX' | 'en-US' }[]
  >;
  /**
   * Id, correo e idioma de la Raíz activa (rango 0): destinataria de los avisos de abuso, como el tope de
   * revelaciones. El id permite llevar un acuse de entrega por destinataria.
   */
  listRootContacts(): Promise<
    readonly {
      readonly id: UserId;
      readonly email: string;
      readonly locale: 'es-MX' | 'en-US';
    }[]
  >;
  /** Directorio visible: usuarios activos, solo nombre, correo y rango. */
  list(query: DirectoryQuery): Promise<DirectoryPage>;
}
