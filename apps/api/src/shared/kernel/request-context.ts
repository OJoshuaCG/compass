import type { OrganizationId, UserId } from './ids.js';

/**
 * Datos de la petición en curso. La organización sale de la sesión autenticada,
 * nunca de un parámetro que envía el cliente.
 */
export interface RequestContext {
  readonly organizationId: OrganizationId;
  /** `null` antes de autenticar (login, invitación) o en procesos del sistema. */
  readonly actorId: UserId | null;
  readonly requestId: string;
  /** Instante de la última reautenticación (step-up); `null` si no hay. */
  readonly reauthAt: Date | null;
}

/** Lectura del contexto actual. Falla cerrada: sin contexto lanza, no devuelve un valor por defecto. */
export interface RequestContextReader {
  current(): RequestContext;
}
