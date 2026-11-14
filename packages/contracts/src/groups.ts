import { z } from 'zod';

export const GROUP_NAME_MAX_LENGTH = 200;
export const GROUP_DESCRIPTION_MAX_LENGTH = 1000;
export const GROUP_MEMBER_ROLES = ['manager', 'member'] as const;
export type GroupMemberRole = (typeof GROUP_MEMBER_ROLES)[number];

/** Crear un grupo: quien lo crea queda como su primer gestor. */
export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH),
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX_LENGTH).nullish(),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

/** `managedByMe=true` acota el listado a los grupos que gestiona quien consulta (selector al compartir). */
export const listGroupsQuerySchema = z.object({
  managedByMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

export const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  /** Papel de quien consulta dentro del grupo; nulo si lo ve por su rango y no es miembro. */
  myRole: z.enum(GROUP_MEMBER_ROLES).nullable(),
  /** Si quien consulta puede agregar y quitar miembros de este grupo. */
  canManageMembers: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Group = z.infer<typeof groupSchema>;

export const groupMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  role: z.enum(GROUP_MEMBER_ROLES),
  addedAt: z.iso.datetime(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const addGroupMemberRequestSchema = z.object({
  userId: z.uuid(),
  role: z.enum(GROUP_MEMBER_ROLES).default('member'),
});
export type AddGroupMemberRequest = z.infer<typeof addGroupMemberRequestSchema>;
