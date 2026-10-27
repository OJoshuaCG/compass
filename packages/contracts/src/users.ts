import { z } from 'zod';

import { rankSchema } from './auth.js';

/** Directorio visible para cualquier usuario activo: solo lo necesario para compartir. */
export const directoryUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  rank: rankSchema,
});
export type DirectoryUser = z.infer<typeof directoryUserSchema>;

/** Campos por los que se puede ordenar el directorio (todos indexados). */
export const DIRECTORY_SORT_FIELDS = ['displayName', 'email', 'rank'] as const;
export type DirectorySortField = (typeof DIRECTORY_SORT_FIELDS)[number];

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Persona que quien consulta puede gestionar (su subárbol; la Raíz ve a todos). A diferencia del
 * directorio visible, incluye estado y responsable: ver detalles requiere poder gestionarlos.
 */
export const managedUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  rank: rankSchema,
  status: userStatusSchema,
  managedBy: z.uuid().nullable(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

/** Acciones sobre una persona gestionada. Cambiar el rango exige reautenticación reciente. */
export const changeRankRequestSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type ChangeRankRequest = z.infer<typeof changeRankRequestSchema>;

export const transferManagerRequestSchema = z.object({ managerId: z.uuid() });
export type TransferManagerRequest = z.infer<typeof transferManagerRequestSchema>;
