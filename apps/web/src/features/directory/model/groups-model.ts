import type {
  CreateGroupRequest,
  DirectoryUser,
  GroupMember,
  GroupMemberRole,
  Rank,
} from '@iam/contracts';

/** Rango de Líder: el mínimo para ser gestor de un grupo (el servidor responde `GROUP.MEMBER_INVALID`). */
const LEADER_RANK: Rank = 2;

/** Rol con el que arranca el formulario de agregar: el de menor privilegio. */
export const DEFAULT_MEMBER_ROLE: GroupMemberRole = 'member';

export type CreateGroupFormValues = {
  name: string;
  description?: string | null | undefined;
};

/**
 * Cuerpo de `POST /groups` desde el formulario. Una descripción vacía o solo de espacios no se
 * envía: el servidor la guarda como ausente y así el listado muestra un solo estado de «sin descripción».
 */
export function toCreateGroupRequest(values: CreateGroupFormValues): CreateGroupRequest {
  const description = values.description?.trim() ?? '';
  if (description === '') return { name: values.name };
  return { name: values.name, description };
}

/**
 * Personas que se pueden ofrecer al agregar: las que aún no son miembros y, si el rol es gestor,
 * con rango de Líder o superior. Es comodidad de la UI; el servidor valida de todos modos
 * (`GROUP.MEMBER_EXISTS`, `GROUP.MEMBER_INVALID`).
 */
export function memberCandidates(
  people: readonly DirectoryUser[],
  members: readonly GroupMember[],
  role: GroupMemberRole,
): DirectoryUser[] {
  const memberIds = new Set(members.map((member) => member.userId));
  return people.filter((person) => {
    if (memberIds.has(person.id)) return false;
    if (role === 'manager' && person.rank > LEADER_RANK) return false;
    return true;
  });
}
