import { z } from 'zod';

/**
 * Sesión activa de una persona. Nunca incluye el token ni su hash: solo lo necesario para que la
 * persona reconozca el dispositivo y decida cerrarla.
 */
export const sessionSummarySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  /** `true` en la sesión desde la que se consulta (no se cierra aquí: para eso está "cerrar sesión"). */
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
