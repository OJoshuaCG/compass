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
