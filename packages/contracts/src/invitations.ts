import { z } from 'zod';

import { emailSchema, safeText } from './text.js';

/** El rango 0 (Raíz) no se invita nunca: la Raíz nace con la organización. */
const invitableRankSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  rank: invitableRankSchema,
  /** Roles que recibirá el invitado; deben respetar el no escalamiento. */
  roleIds: z.array(z.uuid()).max(20).default([]),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/** El enlace con el token se envía por correo; la API nunca lo devuelve a quien invita. */
export const createInvitationResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  rank: invitableRankSchema,
  expiresAt: z.iso.datetime(),
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

/** Invitación todavía sin aceptar ni revocar, tal como la ve quien la envió. Nunca lleva el token. */
export const pendingInvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  rank: invitableRankSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** `true` si ya venció: sigue pendiente hasta que se reenvíe o se invite de nuevo. */
  expired: z.boolean(),
});
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

export const invitationPreviewResponseSchema = z.object({
  email: z.string(),
  rank: invitableRankSchema,
  expiresAt: z.iso.datetime(),
});
export type InvitationPreviewResponse = z.infer<typeof invitationPreviewResponseSchema>;

/** Mínimo 12 caracteres, sin reglas de composición (NIST SP 800-63B); la fortaleza la valida el servidor. */
export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(20).max(200),
  displayName: safeText({ max: 200, min: 1 }),
  password: z.string().min(12).max(1024),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/** Aceptar la invitación abre una sesión "a medias": falta registrar el segundo factor. */
export const acceptInvitationResponseSchema = z.object({
  status: z.literal('enrollment_required'),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
