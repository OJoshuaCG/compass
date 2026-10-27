/**
 * Aviso de "la sesión dejó de ser válida" (401 fuera de un flujo de credenciales). El cliente
 * HTTP lo emite y la app (que conoce router y caché) decide qué limpiar y adónde redirigir
 * (docs/frontend.md §7.2). Se separa así para que `shared/api` no dependa del router.
 */
const listeners = new Set<() => void>();

export function onSessionExpired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  for (const listener of listeners) listener();
}
