import { DIRECTORY_SORT_FIELDS } from '@iam/contracts';
import { z } from 'zod';

/**
 * Ruta de retorno tras iniciar sesión. Solo se acepta una ruta interna ("/algo"): una URL
 * absoluta o "//host" permitiría redirigir a un sitio externo tras el login (open redirect).
 */
export const returnToSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'))
  .optional()
  .catch(undefined);

export const returnToSearchSchema = z.object({ returnTo: returnToSchema });
export type ReturnToSearch = z.infer<typeof returnToSearchSchema>;

/**
 * El token de invitación puede llegar en la query (`?token=`). Es un secreto de un solo uso:
 * la ruta lo lee una vez y lo borra de la URL (ver `invitation-token.ts`).
 */
export const invitationSearchSchema = z.object({
  token: z.string().max(512).optional().catch(undefined),
});

/** Estado de la tabla del directorio en la URL (docs/frontend.md §6.2); el cursor no va aquí. */
export const usersSearchSchema = z.object({
  sort: z.enum(DIRECTORY_SORT_FIELDS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  limit: z
    .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(25)
    .catch(25),
  q: z.string().max(200).optional().catch(undefined),
});
