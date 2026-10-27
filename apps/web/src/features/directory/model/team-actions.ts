import type { ManagedUser, Permission, Rank } from '@iam/contracts';

import { creatableRanks, type InvitableRank } from './creatable-ranks';

export type TeamAction = 'suspend' | 'reactivate' | 'deactivate' | 'changeRank' | 'transfer';

/** Permisos que abren la sección "Gestión del equipo" (basta con uno). */
const MANAGEMENT_PERMISSIONS: readonly Permission[] = [
  'user.deactivate',
  'user.update',
  'user.change_rank',
  'user.transfer',
];

export function canManageTeam(permissions: readonly Permission[]): boolean {
  return MANAGEMENT_PERMISSIONS.some((permission) => permissions.includes(permission));
}

/**
 * Rangos a los que el actor puede mover a una persona: solo con menos autoridad que la suya
 * (número mayor) y distintos del actual. La Raíz nunca es opción (el contrato solo admite 1-3).
 * Es comodidad de la UI; el backend valida siempre.
 */
export function assignableRanks(actorRank: Rank, currentRank: Rank): InvitableRank[] {
  return creatableRanks(actorRank).filter((rank) => rank !== currentRank);
}

/**
 * Candidatos a responsable de `person`: rango estrictamente menor (más autoridad) y no ella
 * misma. El servidor responde `USER.MANAGER_RANK_INVALID` si no se cumple.
 */
export function managerCandidates<T extends { id: string; rank: Rank }>(
  people: readonly T[],
  person: Pick<ManagedUser, 'id' | 'rank'>,
): T[] {
  return people.filter((candidate) => candidate.rank < person.rank && candidate.id !== person.id);
}

/**
 * Acciones que se ofrecen en el menú de una fila. Solo comodidad: oculta lo que no corresponde
 * por estado, rango o permiso, pero el backend decide siempre (docs/frontend.md §1.3).
 * La Raíz y las personas dadas de baja no tienen acciones.
 */
export function availableActions(
  person: ManagedUser,
  actor: { rank: Rank; permissions: readonly Permission[] },
): TeamAction[] {
  if (person.rank === 0 || person.status === 'deactivated') return [];
  const can = (permission: Permission) => actor.permissions.includes(permission);
  const actions: TeamAction[] = [];
  if (person.status === 'active' && can('user.deactivate')) actions.push('suspend');
  if (person.status === 'suspended' && can('user.update')) actions.push('reactivate');
  if (can('user.change_rank') && assignableRanks(actor.rank, person.rank).length > 0) {
    actions.push('changeRank');
  }
  if (can('user.transfer')) actions.push('transfer');
  if (can('user.deactivate')) actions.push('deactivate');
  return actions;
}
