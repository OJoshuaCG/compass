import type { Rank } from '@iam/contracts';

export type InvitableRank = 1 | 2 | 3;

const INVITABLE: readonly InvitableRank[] = [1, 2, 3];

/**
 * Rangos que el actor puede ofrecer al invitar (plan: matriz de creación): solo rangos con
 * menos autoridad que el suyo. La Raíz crea 1-3, un Administrador 2-3 y un Líder solo 3.
 * Es una comodidad de la UI para no ofrecer opciones imposibles; el backend valida siempre y
 * responde `AUTHZ.CREATION_NOT_ALLOWED` si no corresponde.
 */
export function creatableRanks(actorRank: Rank): InvitableRank[] {
  return INVITABLE.filter((rank) => rank > actorRank);
}
