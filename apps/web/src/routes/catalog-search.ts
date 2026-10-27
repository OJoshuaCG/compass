import { z } from 'zod';

import { DEMO_SORT_KEYS } from '../features/catalog';

/**
 * Estado de la tabla en la URL, validado con Zod (docs/frontend.md §6.2). Cada campo usa
 * `.catch` para que un enlace manipulado o antiguo degrade a valores válidos en lugar de
 * romper la pantalla. El cursor no va aquí: caduca y no es compartible.
 */
export const catalogSearchSchema = z.object({
  sort: z.enum(DEMO_SORT_KEYS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  limit: z
    .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(25)
    .catch(25),
  q: z.string().optional().catch(undefined),
});
