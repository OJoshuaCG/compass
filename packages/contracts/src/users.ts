import { z } from 'zod';

import { shareLevelSchema } from './accounts.js';
import { rankSchema } from './auth.js';
import { shareGranteeTypeSchema } from './shares.js';
import { safeText } from './text.js';

/** Directorio visible para cualquier usuario activo: solo lo necesario para compartir. */
export const directoryUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  rank: rankSchema,
});
export type DirectoryUser = z.infer<typeof directoryUserSchema>;

/** Campos por los que se puede ordenar el directorio (todos indexados). */
export const DIRECTORY_SORT_FIELDS = ['displayName', 'email', 'rank'] as const;
export type DirectorySortField = (typeof DIRECTORY_SORT_FIELDS)[number];

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Persona que quien consulta puede gestionar (su subárbol; la Raíz ve a todos). A diferencia del
 * directorio visible, incluye estado y responsable: ver detalles requiere poder gestionarlos.
 */
export const managedUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  rank: rankSchema,
  status: userStatusSchema,
  managedBy: z.uuid().nullable(),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;

/** Largo máximo del motivo de un cambio de rango; coincide con el límite de la auditoría para texto libre. */
export const RANK_CHANGE_REASON_MAX_LENGTH = 500;

/**
 * Tope de comparticiones que devuelve el cambio de rango. La lista completa puede ser larga y la
 * respuesta se guarda 24 horas (idempotencia): se acota y se informa el total aparte.
 */
export const RANK_CHANGE_MAX_SHARED_ACCOUNTS = 100;

/**
 * Acciones sobre una persona gestionada. Cambiar el rango exige reautenticación reciente. El motivo
 * es opcional al bajar de rango y obligatorio al subirlo; esa regla la aplica el servidor (código
 * `USER.RANK_REASON_REQUIRED`) porque depende del rango actual de la persona.
 */
export const changeRankRequestSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reason: safeText({ max: RANK_CHANGE_REASON_MAX_LENGTH }).optional(),
});
export type ChangeRankRequest = z.infer<typeof changeRankRequestSchema>;

const roleSummarySchema = z.object({ id: z.uuid(), name: z.string() });

/**
 * Comparticiones vivas que la persona otorgó. Solo ids, nivel y vencimiento: quien cambia el rango
 * no necesariamente ve esas cuentas (el rango nunca concede acceso a una cuenta), así que no se
 * devuelven nombres de cuentas.
 */
const sharedAccountSchema = z.object({
  shareId: z.uuid(),
  accountId: z.uuid(),
  granteeType: shareGranteeTypeSchema,
  granteeId: z.uuid(),
  level: shareLevelSchema,
  expiresAt: z.iso.datetime().nullable(),
});

/** Resultado de cambiar el rango (200): qué roles se quitaron, cuál se asignó y qué quedó compartido. */
export const rankChangeResponseSchema = z.object({
  removedRoles: z.array(roleSummarySchema),
  assignedRole: roleSummarySchema.nullable(),
  sharedAccounts: z.array(sharedAccountSchema).max(RANK_CHANGE_MAX_SHARED_ACCOUNTS),
  sharedAccountCount: z.number().int().nonnegative(),
});
export type RankChangeResponse = z.infer<typeof rankChangeResponseSchema>;

export const transferManagerRequestSchema = z.object({ managerId: z.uuid() });
export type TransferManagerRequest = z.infer<typeof transferManagerRequestSchema>;
