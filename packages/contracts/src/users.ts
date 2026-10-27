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
