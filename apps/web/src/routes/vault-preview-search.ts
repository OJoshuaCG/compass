import { z } from 'zod';

import { VAULT_SORT_KEYS, VAULT_VIEWS } from '../features/vault-preview';

/**
 * Estado de la vista previa de la bóveda en la URL (docs/frontend.md §6.2): vista, búsqueda,
 * orden y límite. Cada campo degrada a un valor válido con `.catch`.
 */
export const vaultPreviewSearchSchema = z.object({
  view: z.enum(VAULT_VIEWS).default('all').catch('all'),
  sort: z.enum(VAULT_SORT_KEYS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  limit: z
    .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(25)
    .catch(25),
  q: z.string().optional().catch(undefined),
});
