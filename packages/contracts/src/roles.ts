import { z } from 'zod';

import { PERMISSIONS } from './permissions.js';
import { safeText } from './text.js';

const permissionSchema = z.enum(PERMISSIONS);

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Las plantillas del sistema no se editan ni se archivan. */
  isSystem: z.boolean(),
  permissions: z.array(permissionSchema),
});
export type Role = z.infer<typeof roleSchema>;

/** Un rol personalizado solo puede contener permisos que su creador ya tiene (no escalamiento). */
export const createRoleRequestSchema = z.object({
  name: safeText({ max: 100, min: 1 }),
  permissions: z.array(permissionSchema).min(1).max(PERMISSIONS.length),
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

/**
 * Reemplazo completo del nombre y los permisos de un rol personalizado. Quien edita debe tener tanto los
 * permisos que quita como los que pone: editar un rol ya asignado equivale a escalar a sus titulares.
 */
export const updateRoleRequestSchema = z.object({
  name: safeText({ max: 100, min: 1 }),
  permissions: z.array(permissionSchema).min(1).max(PERMISSIONS.length),
});
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

/** Un permiso del catálogo con el rango más bajo (número más alto) que puede tenerlo. */
export const permissionCatalogEntrySchema = z.object({
  permission: permissionSchema,
  maxRank: z.number().int().min(0).max(3),
});
export type PermissionCatalogEntry = z.infer<typeof permissionCatalogEntrySchema>;

/**
 * Roles elegibles de una persona y sus permisos especiales (los de su rol personal oculto, que no
 * viaja como rol).
 */
export const personRolesSchema = z.object({
  roles: z.array(roleSchema),
  specialPermissions: z.array(permissionSchema),
});
export type PersonRoles = z.infer<typeof personRolesSchema>;

/** Reemplazo completo de los roles elegibles de la persona; el rol personal no se toca. */
export const setPersonRolesRequestSchema = z.object({
  roleIds: z.array(z.uuid()).max(50),
});
export type SetPersonRolesRequest = z.infer<typeof setPersonRolesRequestSchema>;

/** Reemplazo completo de los permisos especiales de la persona; vacío los retira todos. */
export const setSpecialPermissionsRequestSchema = z.object({
  permissions: z.array(permissionSchema).max(PERMISSIONS.length),
});
export type SetSpecialPermissionsRequest = z.infer<typeof setSpecialPermissionsRequestSchema>;
