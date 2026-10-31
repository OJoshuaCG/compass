import { z } from 'zod';

import { safeText } from './text.js';

/** Niveles de acceso a una cuenta, de menor a mayor: USE < VIEW < EDIT < MANAGE. */
export const SHARE_LEVELS = ['USE', 'VIEW', 'EDIT', 'MANAGE'] as const;
export const shareLevelSchema = z.enum(SHARE_LEVELS);
export type ShareLevel = z.infer<typeof shareLevelSchema>;

export const platformSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  loginUrl: z.string().nullable(),
  supportsTotp: z.boolean(),
  /** `true` para las plataformas del catálogo global; `false` para las de la organización. */
  isGlobal: z.boolean(),
});
export type Platform = z.infer<typeof platformSchema>;

const MAX_TAGS = 20;
const tagSchema = safeText({ max: 50, min: 1 });

export const accountSchema = z.object({
  id: z.uuid(),
  platformId: z.uuid(),
  displayName: z.string(),
  handle: z.string().nullable(),
  ownerGroupId: z.uuid().nullable(),
  tags: z.array(z.string()),
  status: z.enum(['active', 'archived']),
  /** Nivel con el que quien consulta accede; `null` en el inventario, que no concede acceso. */
  myLevel: shareLevelSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type Account = z.infer<typeof accountSchema>;

export const createAccountRequestSchema = z.object({
  platformId: z.uuid(),
  displayName: safeText({ max: 200, min: 1 }),
  handle: safeText({ max: 200, min: 1 }).optional(),
  ownerGroupId: z.uuid().optional(),
  tags: z.array(tagSchema).max(MAX_TAGS).optional(),
});
export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

/** Reemplazo parcial: solo viajan los campos que cambian; `null` borra el valor opcional. */
export const updateAccountRequestSchema = z
  .object({
    displayName: safeText({ max: 200, min: 1 }).optional(),
    handle: safeText({ max: 200, min: 1 }).nullable().optional(),
    ownerGroupId: z.uuid().nullable().optional(),
    tags: z.array(tagSchema).max(MAX_TAGS).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });
export type UpdateAccountRequest = z.infer<typeof updateAccountRequestSchema>;
