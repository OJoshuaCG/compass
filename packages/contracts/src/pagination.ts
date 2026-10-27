import { z } from 'zod';

/** Tamaños de página permitidos; coinciden con el selector de `DataTable`. */
export const PAGE_LIMITS = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type PageLimit = (typeof PAGE_LIMITS)[number];

/**
 * Parámetros de listado por cursor. `sort` se valida contra una lista blanca por endpoint
 * (solo campos indexados), no aquí.
 */
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .refine((n): n is PageLimit => (PAGE_LIMITS as readonly number[]).includes(n), {
      message: 'limit must be one of 10, 25, 50, 100',
    })
    .default(DEFAULT_PAGE_LIMIT),
  sort: z.string().min(1).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Envoltorio de respuesta de listados: `{ data, page: { nextCursor, limit, total? } }`. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.object({
      nextCursor: z.string().nullable(),
      limit: z.number().int().min(1).max(MAX_PAGE_LIMIT),
      total: z.number().int().nonnegative().optional(),
    }),
  });
}
