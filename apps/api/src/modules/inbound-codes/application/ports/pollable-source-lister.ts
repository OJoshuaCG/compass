import type { SourceRef } from './poll-state-store.js';

/**
 * Fuentes de correo que toca sondear ahora (activas, con contraseña, sin backoff vigente ni arrendamiento
 * activo). El orden lo decide quien lista: las que llevan más tiempo sin sondearse van primero.
 */
export interface PollableSourceLister {
  list(): Promise<readonly SourceRef[]>;
}
