import { z } from 'zod';

import { hasControlCharacter, safeText } from './text.js';

/** Largo del motivo escrito que se exige para revelar una contraseña (decisión del dueño, 2026-10-28). */
export const REVEAL_REASON_MIN_LENGTH = 6;
export const REVEAL_REASON_MAX_LENGTH = 500;

/** Tope de revelaciones exitosas por persona en una ventana móvil de una hora (ADR 0031). */
export const REVEAL_LIMIT_PER_HOUR = 30;

export const CREDENTIAL_KINDS = ['password', 'password_totp', 'totp_only'] as const;
export const credentialKindSchema = z.enum(CREDENTIAL_KINDS);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

/** Una contraseña puede llevar cualquier carácter, así que solo se acota el largo; nunca se recorta. */
const passwordSchema = z.string().min(1).max(1024);

/** Metadatos de una credencial: nunca incluye usuario ni contraseña. */
export const credentialSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  label: z.string(),
  kind: credentialKindSchema,
  lastRotatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Credential = z.infer<typeof credentialSchema>;

export const createCredentialRequestSchema = z.object({
  label: safeText({ min: 1, max: 200 }),
  username: safeText({ min: 1, max: 256 }),
  password: passwordSchema,
});
export type CreateCredentialRequest = z.infer<typeof createCredentialRequestSchema>;

export const changeCredentialPasswordRequestSchema = z.object({ password: passwordSchema });
export type ChangeCredentialPasswordRequest = z.infer<typeof changeCredentialPasswordRequestSchema>;

/**
 * El largo del motivo se valida en el caso de uso, no aquí: un motivo ausente o fuera de rango debe
 * dejar una negación auditada (una validación 422 del borde no deja rastro).
 */
export const revealPasswordRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type RevealPasswordRequest = z.infer<typeof revealPasswordRequestSchema>;

/** El motivo es válido con longitud 6 a 500 después de recortar espacios, y sin caracteres de control. */
export const isValidRevealReason = (reason: string | undefined): reason is string => {
  if (reason === undefined) return false;
  const trimmed = reason.trim();
  return (
    trimmed.length >= REVEAL_REASON_MIN_LENGTH &&
    trimmed.length <= REVEAL_REASON_MAX_LENGTH &&
    !hasControlCharacter(trimmed)
  );
};

export const passwordVersionSchema = z.object({
  version: z.number().int().positive(),
  isCurrent: z.boolean(),
  createdAt: z.iso.datetime(),
  createdBy: z.uuid(),
});
export type PasswordVersion = z.infer<typeof passwordVersionSchema>;

export const revealedPasswordSchema = z.object({ password: z.string() });
export type RevealedPassword = z.infer<typeof revealedPasswordSchema>;

export const credentialUsernameSchema = z.object({ username: z.string() });
export type CredentialUsername = z.infer<typeof credentialUsernameSchema>;
