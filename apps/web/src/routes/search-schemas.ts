import { DIRECTORY_SORT_FIELDS } from '@iam/contracts';
import { z } from 'zod';

/**
 * Una ruta de retorno es válida solo si, tal como la interpreta el navegador, es interna.
 * El navegador elimina tab/saltos de línea al analizar URLs (`/\t/evil.com` pasa a
 * `//evil.com`), así que primero se rechaza todo lo que no sea ASCII imprimible sin espacios
 * y después se verifica con `URL` que el origen resultante es el propio.
 */
export function isSafeReturnTo(value: string): boolean {
  if (value.length > 2048 || !/^[\x21-\x7e]+$/.test(value) || value.includes('\\')) return false;
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const { origin } = globalThis.location;
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname.startsWith('/') && !url.pathname.startsWith('//');
  } catch {
    return false;
  }
}

/**
 * Ruta de retorno tras iniciar sesión. Solo se acepta una ruta interna ("/algo"): una URL
 * absoluta o "//host" permitiría redirigir a un sitio externo tras el login (open redirect).
 */
export const returnToSchema = z.string().refine(isSafeReturnTo).optional().catch(undefined);

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
  /** Sección de la página: ausente = directorio. */
  view: z.enum(['directory', 'team', 'invitations']).optional().catch(undefined),
  sort: z.enum(DIRECTORY_SORT_FIELDS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  limit: z
    .union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .default(25)
    .catch(25),
  q: z.string().max(200).optional().catch(undefined),
});
