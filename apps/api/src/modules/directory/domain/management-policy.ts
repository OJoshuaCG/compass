/**
 * Reglas de jerarquía (plan: "Actores y jerarquía: reglas formales"). Son funciones puras: el
 * dominio no consulta la base de datos; quien las llama le dice si el objetivo está en el
 * subárbol de gestión del actor (la consulta recursiva vive en infraestructura).
 *
 * Invariantes de seguridad
 * - Un actor solo gestiona a quien tiene un rango estrictamente MAYOR (menos autoridad).
 * - Fuera de la Raíz, además el objetivo debe estar en el subárbol del actor: dos Administradores
 *   se ignoran entre sí aunque ambos superen a un Líder.
 * - Nadie se gestiona a sí mismo, y un actor inactivo no gestiona a nadie.
 */
import type { Rank } from '../../../shared/kernel/index.js';
import { RANK } from '../../../shared/kernel/index.js';
import type { UserSubject } from './user.js';

/** Matriz de creación: la Raíz crea a los tres; el Administrador a Líder y Operador; etc. */
export function canCreateRank(actorRank: Rank, targetRank: Rank): boolean {
  if (targetRank === RANK.ROOT) return false; // la Raíz nace con la organización, nunca se invita
  return actorRank < RANK.OPERATOR && targetRank > actorRank;
}

export function canManage(
  actor: UserSubject,
  target: UserSubject,
  targetInActorSubtree: boolean,
): boolean {
  if (actor.status !== 'active') return false;
  if (actor.organizationId !== target.organizationId) return false;
  if (actor.id === target.id) return false;
  if (actor.rank === RANK.ROOT) return true;
  return actor.rank < target.rank && targetInActorSubtree;
}

/**
 * Regla 4: quien transfiere debe gestionar a T; el nuevo responsable M es el propio actor o está
 * en su subárbol, y debe tener un rango menor (más autoridad) que T.
 */
export function canTransferManager(input: {
  readonly actor: UserSubject;
  readonly target: UserSubject;
  readonly targetInActorSubtree: boolean;
  readonly newManager: UserSubject;
  readonly newManagerIsActorOrInSubtree: boolean;
}): boolean {
  const { actor, target, newManager } = input;
  if (!canManage(actor, target, input.targetInActorSubtree)) return false;
  if (newManager.organizationId !== actor.organizationId) return false;
  if (newManager.status !== 'active' || newManager.id === target.id) return false;
  return input.newManagerIsActorOrInSubtree && newManager.rank < target.rank;
}

/**
 * Regla 5: solo quien gestiona a T cambia su rango; el nuevo rango debe respetar la matriz de
 * creación del actor, y bajar a alguien con subordinados se bloquea hasta reasignarlos.
 */
export function canChangeRank(input: {
  readonly actor: UserSubject;
  readonly target: UserSubject;
  readonly targetInActorSubtree: boolean;
  readonly newRank: Rank;
  readonly targetHasReports: boolean;
}): boolean {
  const { actor, target, newRank } = input;
  if (!canManage(actor, target, input.targetInActorSubtree)) return false;
  if (!canCreateRank(actor.rank, newRank)) return false;
  const demotion = newRank > target.rank;
  return !(demotion && input.targetHasReports);
}
