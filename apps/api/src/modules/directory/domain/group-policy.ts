/**
 * Reglas puras de grupos (docs/business/permissions-and-sharing.md §2.3 y docs/business/README.md).
 */
import type { GroupMemberRole } from '@iam/contracts';

import { RANK } from '../../../shared/kernel/index.js';
import type { Rank } from '../../../shared/kernel/index.js';

/** Rango máximo (inclusive) que ve todos los grupos y administra cualquiera: Raíz y Administradores. */
const MAX_RANK_WITH_FULL_GROUP_ACCESS = RANK.ADMINISTRATOR;
/** Rango máximo (inclusive) de quien puede ser gestor de un grupo: Raíz, Administradores y Líderes. */
const MAX_RANK_OF_GROUP_MANAGER = RANK.LEADER;

export interface GroupRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Quien tiene rango de Administrador o superior administra cualquier grupo; el resto, solo los que gestiona. */
export const canManageGroupMembers = (
  actorRank: Rank,
  actorRoleInGroup: GroupMemberRole | null,
): boolean => actorRank <= MAX_RANK_WITH_FULL_GROUP_ACCESS || actorRoleInGroup === 'manager';

/** Ver todos los grupos exige rango alto o un permiso de gestión de grupos; si no, solo los propios. */
export const seesEveryGroup = (actorRank: Rank, hasGroupPermission: boolean): boolean =>
  actorRank <= MAX_RANK_WITH_FULL_GROUP_ACCESS || hasGroupPermission;

/** Una persona operativa puede ser miembro, pero no gestora (el gestor administra a otras personas). */
export const canHoldGroupRole = (targetRank: Rank, role: GroupMemberRole): boolean =>
  role === 'member' || targetRank <= MAX_RANK_OF_GROUP_MANAGER;
