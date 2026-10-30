import { z } from 'zod';

import { hasControlCharacter } from './text.js';

export const TOTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;
export const totpAlgorithmSchema = z.enum(TOTP_ALGORITHMS);
export type TotpAlgorithm = z.infer<typeof totpAlgorithmSchema>;

export const TOTP_STATUSES = ['pending', 'verified', 'retired'] as const;
export const totpStatusSchema = z.enum(TOTP_STATUSES);
export type TotpStatus = z.infer<typeof totpStatusSchema>;

/** Tope de códigos emitidos por persona y credencial en una ventana de un minuto (propuesta pendiente de confirmar). */
export const TOTP_CODES_PER_MINUTE = 10;

/**
 * Fallos consecutivos de confirmación que se toleran por registro pendiente antes de bloquearlo por tiempo.
 * La especificación no fija el número: se alinea con el umbral de bloqueo del segundo factor de identidad
 * (10 fallos).
 */
export const TOTP_CONFIRM_MAX_FAILURES = 10;

/**
 * Duración (en minutos) de cada bloqueo de confirmación, escalonada por registro: la 1ª vez 5 minutos, la
 * 2ª 15 y de la 3ª en adelante 60. El bloqueo es temporal para que nadie pueda dejar fuera a otra persona de
 * forma permanente, y crece para que adivinar el código siga saliendo caro. Decisión del dueño (T5b).
 */
export const TOTP_CONFIRM_LOCK_MINUTES_BY_LEVEL: readonly number[] = [5, 15, 60];

/** Cuando faltan menos segundos que esto, la respuesta incluye también el código siguiente. */
export const TOTP_NEXT_CODE_THRESHOLD_SECONDS = 5;

/** Largo máximo aceptado del URI `otpauth://`: acota el cuerpo antes de analizarlo. */
export const OTPAUTH_URI_MAX_LENGTH = 2048;

/** Metadatos del segundo factor de una credencial: nunca incluye el secreto ni el URI. */
export const credentialTotpSchema = z.object({
  status: totpStatusSchema,
  algorithm: totpAlgorithmSchema,
  digits: z.union([z.literal(6), z.literal(8)]),
  periodSeconds: z.union([z.literal(30), z.literal(60)]),
  registeredAt: z.iso.datetime(),
  verifiedAt: z.iso.datetime().nullable(),
  /** `true` si el secreto se exportó alguna vez: ya no lo conoce solo la bóveda. */
  exposed: z.boolean(),
});
export type CredentialTotp = z.infer<typeof credentialTotpSchema>;

/** El URI se valida a fondo en el servidor (esquema, tipo, algoritmo, dígitos, periodo y clave). */
export const registerTotpRequestSchema = z.object({
  otpauthUri: z
    .string()
    .min(1)
    .max(OTPAUTH_URI_MAX_LENGTH)
    .refine((value) => !hasControlCharacter(value), 'no control characters'),
});
export type RegisterTotpRequest = z.infer<typeof registerTotpRequestSchema>;

export const confirmTotpRequestSchema = z.object({
  code: z.string().regex(/^\d{6,8}$/),
});
export type ConfirmTotpRequest = z.infer<typeof confirmTotpRequestSchema>;

export const totpCodeSchema = z.object({
  code: z.string(),
  /** Segundos que le quedan de vigencia al código. */
  expiresIn: z.number().int().min(0),
  /** Solo viaja cuando quedan menos de `TOTP_NEXT_CODE_THRESHOLD_SECONDS` segundos. */
  nextCode: z.string().optional(),
});
export type TotpCode = z.infer<typeof totpCodeSchema>;

/** El motivo se valida en el caso de uso (como al revelar) para que una negación deje rastro de auditoría. */
export const exportTotpRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type ExportTotpRequest = z.infer<typeof exportTotpRequestSchema>;

export const exportedTotpSchema = z.object({
  otpauthUri: z.string(),
  /** La clave en Base32 para teclearla a mano cuando no se puede escanear. */
  secretKey: z.string(),
});
export type ExportedTotp = z.infer<typeof exportedTotpSchema>;
