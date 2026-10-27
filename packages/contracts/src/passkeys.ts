import { z } from 'zod';

import { safeText } from './text.js';

/** Llave de acceso registrada. Nunca incluye la llave pública ni el identificador de credencial. */
export const passkeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof passkeySchema>;

/**
 * La respuesta del navegador (`PublicKeyCredential` en JSON) se valida a fondo en el servidor con
 * la biblioteca de WebAuthn; aquí solo se acota su forma general y su tamaño.
 */
const ceremonyResponseSchema = z
  .object({ id: z.string().min(1).max(1024), type: z.literal('public-key') })
  .loose();

export const registerPasskeyRequestSchema = z.object({
  name: safeText({ max: 100, min: 1 }),
  response: ceremonyResponseSchema,
});
export type RegisterPasskeyRequest = z.infer<typeof registerPasskeyRequestSchema>;

export const passkeyLoginRequestSchema = z.object({ response: ceremonyResponseSchema });
export type PasskeyLoginRequest = z.infer<typeof passkeyLoginRequestSchema>;
