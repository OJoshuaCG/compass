import { z } from 'zod';

import { fixedOrderPageQuerySchema } from './pagination.js';
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

/**
 * Antigüedad del último cambio de contraseña, como semáforo informativo (nunca obliga a cambiarla):
 * `fresh` hasta 60 días, `aging` de más de 60 hasta 90, `stale` de más de 90 y `none` sin credenciales.
 * `unknown` es el inventario: quien lo consulta no tiene acceso a la cuenta, así que no se le revela
 * nada de sus credenciales (ni siquiera si las tiene).
 */
export const PASSWORD_AGE_STATUSES = ['fresh', 'aging', 'stale', 'none', 'unknown'] as const;
export const passwordAgeStatusSchema = z.enum(PASSWORD_AGE_STATUSES);
export type PasswordAgeStatus = z.infer<typeof passwordAgeStatusSchema>;

/** Una cuenta en los listados: lo de `Account` más el resumen de antigüedad de sus credenciales. */
export const accountListItemSchema = accountSchema.extend({
  /** Último cambio de la credencial más antigua de la cuenta; `null` si no tiene credenciales. */
  lastChangedAt: z.iso.datetime().nullable(),
  passwordAge: passwordAgeStatusSchema,
});
export type AccountListItem = z.infer<typeof accountListItemSchema>;

/** Filtros rápidos de los listados: `review` = amarillo y rojo; `no-2fa` = falta el segundo factor. */
export const ACCOUNT_LIST_FILTERS = ['review', 'no-2fa'] as const;
export const accountListFilterSchema = z.enum(ACCOUNT_LIST_FILTERS);
export type AccountListFilter = z.infer<typeof accountListFilterSchema>;

const ACCOUNT_SEARCH_MAX_LENGTH = 100;

/** Listados de cuentas: orden fijo por nombre, con búsqueda de texto y un filtro rápido opcionales. */
export const accountListQuerySchema = fixedOrderPageQuerySchema.extend({
  q: safeText({ max: ACCOUNT_SEARCH_MAX_LENGTH, min: 1 }).optional(),
  filter: accountListFilterSchema.optional(),
});
export type AccountListQuery = z.infer<typeof accountListQuerySchema>;

/**
 * Inventario: solo búsqueda de texto. Los filtros rápidos usan datos de credenciales, que el inventario
 * no debe revelar; `strict` hace que pedir `filter` falle en vez de ignorarse en silencio.
 */
export const inventoryListQuerySchema = fixedOrderPageQuerySchema
  .extend({ q: safeText({ max: ACCOUNT_SEARCH_MAX_LENGTH, min: 1 }).optional() })
  .strict();
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

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
