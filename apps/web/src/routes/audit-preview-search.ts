import { z } from 'zod';

import { AUDIT_RANGES, AUDIT_TYPE_FILTERS } from '../features/audit-preview';

/**
 * Estado de la vista previa de auditoría en la URL (docs/frontend.md §6.2): tipo, periodo,
 * búsqueda y límite. Cada campo degrada a un valor válido con `.catch`.
 */
export const auditPreviewSearchSchema = z.object({
  type: z.enum(AUDIT_TYPE_FILTERS).default('all').catch('all'),
  range: z.enum(AUDIT_RANGES).default('7d').catch('7d'),
  limit: z
    .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(25)
    .catch(25),
  q: z.string().optional().catch(undefined),
});
