import type { ManagedUser, Rank } from '@iam/contracts';

/**
 * Responsables que se pueden ofrecer al invitar a una persona de rango `inviteeRank`: activos, con
 * rango estrictamente superior (número menor) al del invitado y distintos de quien invita (quien
 * invita ya es la opción por defecto). Es comodidad de la UI; el servidor valida alcance y rango.
 */
export function invitableManagers(
  people: readonly ManagedUser[],
  actorId: string | undefined,
  inviteeRank: Rank,
): ManagedUser[] {
  return people.filter(
    (person) => person.status === 'active' && person.rank < inviteeRank && person.id !== actorId,
  );
}
