import { z } from 'zod';

import { ceremonyResponseSchema } from './passkeys.js';
import { PERMISSIONS } from './permissions.js';
import { emailSchema } from './text.js';

/** Rango numérico: 0 Raíz, 1 Administrador, 2 Líder, 3 Operador (menor = más autoridad). */
export const rankSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Rank = z.infer<typeof rankSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Tras la contraseña la sesión (cookie) queda "a medias": falta el segundo factor. `mfa_required`
 * pide el código del autenticador; `enrollment_required` obliga a registrarlo antes de entrar.
 */
export const loginResponseSchema = z.object({
  status: z.enum(['password_change_required', 'mfa_required', 'enrollment_required']),
  /** Solo con `mfa_required`: la persona tiene llaves de acceso y puede usarlas en lugar del código. */
  passkeys: z.boolean().optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Cambio de contraseña (la inicial de la Raíz es de un solo uso). Pide la actual para que una sesión
 * robada no pueda cambiarla; la nueva cumple la misma política que al aceptar una invitación.
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

const totpCodeSchema = z.string().regex(/^\d{6,8}$/);

export const mfaVerifyRequestSchema = z.object({ code: totpCodeSchema });
export type MfaVerifyRequest = z.infer<typeof mfaVerifyRequestSchema>;

/** Código de recuperación: 10 caracteres alfanuméricos con guion opcional (se normaliza en el servidor). */
export const recoveryCodeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(8)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/),
});
export type RecoveryCodeRequest = z.infer<typeof recoveryCodeRequestSchema>;

export const totpEnrollResponseSchema = z.object({
  /** Clave en Base32, para escribirla a mano en el autenticador. */
  secret: z.string().min(16),
  /** URI `otpauth://` para generar el QR en el cliente. */
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});
export type TotpEnrollResponse = z.infer<typeof totpEnrollResponseSchema>;

export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });
export type TotpConfirmRequest = z.infer<typeof totpConfirmRequestSchema>;

/** Los códigos de recuperación se muestran UNA sola vez. */
export const totpConfirmResponseSchema = z.object({
  recoveryCodes: z.array(z.string().min(8)).length(10),
});
export type TotpConfirmResponse = z.infer<typeof totpConfirmResponseSchema>;

export const reauthRequestSchema = z.object({ code: totpCodeSchema });
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

/** Reautenticación con llave de acceso (ADR 0033): la respuesta de la ceremonia WebAuthn. */
export const reauthPasskeyRequestSchema = z.object({ response: ceremonyResponseSchema });
export type ReauthPasskeyRequest = z.infer<typeof reauthPasskeyRequestSchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    rank: rankSchema,
    locale: z.enum(['es-MX', 'en-US']),
    timezone: z.string(),
  }),
  /** Permisos efectivos: unión de roles recortada por el techo del rango. */
  permissions: z.array(z.enum(PERMISSIONS)),
  session: z.object({
    expiresAt: z.iso.datetime(),
    /** Instante hasta el cual la reautenticación sigue vigente (5 min), o `null`. */
    reauthUntil: z.iso.datetime().nullable(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
