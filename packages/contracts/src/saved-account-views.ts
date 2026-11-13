import { z } from 'zod';

import { accountListFilterSchema } from './accounts.js';
import { safeText } from './text.js';

export const SAVED_VIEW_NAME_MAX_LENGTH = 60;
export const SAVED_VIEW_SEARCH_MAX_LENGTH = 100;
/** Máximo de vistas guardadas por persona (mismo criterio que las llaves de acceso). */
export const MAX_SAVED_VIEWS = 10;

export const savedAccountViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  q: z.string().nullable(),
  filter: accountListFilterSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type SavedAccountView = z.infer<typeof savedAccountViewSchema>;

/** Una vista necesita al menos un criterio: texto o filtro rápido. */
export const createSavedAccountViewRequestSchema = z
  .object({
    name: safeText({ max: SAVED_VIEW_NAME_MAX_LENGTH, min: 1 }),
    q: safeText({ max: SAVED_VIEW_SEARCH_MAX_LENGTH, min: 1 }).optional(),
    filter: accountListFilterSchema.optional(),
  })
  .refine((body) => body.q !== undefined || body.filter !== undefined, {
    message: 'A saved view needs a search text or a quick filter',
  });
export type CreateSavedAccountViewRequest = z.infer<typeof createSavedAccountViewRequestSchema>;
