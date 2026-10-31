import { z } from 'zod';

import { shareLevelSchema } from './accounts.js';

/** A quién se comparte una cuenta: una persona o un grupo. */
export const SHARE_GRANTEE_TYPES = ['user', 'group'] as const;
export const shareGranteeTypeSchema = z.enum(SHARE_GRANTEE_TYPES);
export type ShareGranteeType = z.infer<typeof shareGranteeTypeSchema>;

/** Una compartición vigente de una cuenta. `granteeName` es el nombre visible de la persona o del grupo. */
export const shareSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  granteeType: shareGranteeTypeSchema,
  granteeId: z.uuid(),
  granteeName: z.string(),
  level: shareLevelSchema,
  /** `null` cuando el acceso no caduca. */
  expiresAt: z.iso.datetime().nullable(),
  grantedBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Share = z.infer<typeof shareSchema>;

export const createShareRequestSchema = z.object({
  granteeType: shareGranteeTypeSchema,
  granteeId: z.uuid(),
  level: shareLevelSchema,
  /** Opcional; si viaja debe ser futura y no superar un año (la regla la aplica el servidor). */
  expiresAt: z.iso.datetime().optional(),
});
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;
