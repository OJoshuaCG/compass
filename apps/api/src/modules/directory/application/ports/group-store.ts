import type { GroupMemberRole } from '@iam/contracts';

import type { GroupRecord } from '../../domain/group-policy.js';

export interface GroupSummaryRow extends GroupRecord {
  readonly memberCount: number;
  /** Papel de la persona que consulta en este grupo; nulo si no es miembro. */
  readonly roleOfViewer: GroupMemberRole | null;
}

export interface GroupMemberRow {
  readonly userId: string;
  readonly displayName: string;
  readonly role: GroupMemberRole;
  readonly addedAt: Date;
}

/** Acceso a grupos y membresías; toda consulta corre en la transacción de la organización (RLS). */
export interface GroupStore {
  /** Devuelve nulo si ya existe un grupo activo con ese nombre (sin distinguir mayúsculas). */
  insertGroup(input: {
    readonly name: string;
    readonly description: string | null;
    readonly createdBy: string;
  }): Promise<GroupRecord | null>;
  /** Bloquea la fila del grupo vivo para serializar cambios de miembros. */
  findLiveForUpdate(groupId: string): Promise<GroupRecord | null>;
  /**
   * Toma un bloqueo compartido sobre la fila de la persona: una baja concurrente (que la actualiza)
   * espera a este cambio o este espera a que la baja confirme, de modo que nadie entra a un grupo ya dado de baja.
   */
  lockUserRow(userId: string): Promise<void>;
  findLive(groupId: string): Promise<GroupRecord | null>;
  /** `viewerId` fija el papel propio; `onlyOfViewer` restringe a los grupos donde es miembro. */
  listLive(input: {
    readonly viewerId: string;
    readonly onlyOfViewer: boolean;
    readonly onlyManagedByViewer: boolean;
  }): Promise<readonly GroupSummaryRow[]>;
  roleOf(groupId: string, userId: string): Promise<GroupMemberRole | null>;
  listMembers(groupId: string): Promise<readonly GroupMemberRow[]>;
  /** Devuelve falso si la persona ya era miembro. */
  addMember(input: {
    readonly groupId: string;
    readonly userId: string;
    readonly role: GroupMemberRole;
    readonly addedBy: string;
  }): Promise<boolean>;
  removeMember(groupId: string, userId: string): Promise<void>;
  countManagers(groupId: string): Promise<number>;
}
