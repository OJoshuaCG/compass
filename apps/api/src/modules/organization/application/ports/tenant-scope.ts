import type { RequestContext, Result } from '../../../../shared/kernel/index.js';

/** Contexto con el que se ejecuta un bloque de trabajo: la organización la resolvió el sistema, no el cliente. */
export type ScopeContext = Pick<RequestContext, 'organizationId' | 'actorId' | 'requestId'> &
  Partial<Pick<RequestContext, 'sessionId' | 'reauthAt'>>;

/**
 * Ejecuta trabajo "como" una organización (login, aceptar invitación, validar sesión): en esos
 * puntos la organización se conoce por una consulta previa, no por una sesión ya establecida.
 */
export interface TenantScope {
  /** Una transacción con el contexto fijado. Confirma si `fn` termina; revierte solo si lanza. */
  runAs<T>(context: ScopeContext, fn: () => Promise<T>): Promise<T>;
  /** Igual, pero también revierte todo si `fn` devuelve un error (`ok: false`). */
  runAsAtomic<T, E>(context: ScopeContext, fn: () => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
