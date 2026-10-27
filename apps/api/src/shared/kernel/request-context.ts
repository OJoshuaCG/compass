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
  /** Sesión que originó la petición; `null` en procesos del sistema y antes de autenticar. */
  readonly sessionId: string | null;
  /** Instante de la última reautenticación (step-up); `null` si no hay. */
  readonly reauthAt: Date | null;
}

/** Lectura del contexto actual. Falla cerrada: sin contexto lanza, no devuelve un valor por defecto. */
export interface RequestContextReader {
  current(): RequestContext;
}

/** Quien puede fijar el `RequestContext` para el resto de la cadena asíncrona de una petición. */
export interface RequestContextRunner {
  run<T>(context: RequestContext, fn: () => T): T;
}
