/**
 * Sincroniza el fin de la sesión entre las pestañas del mismo navegador con un canal de difusión
 * (docs/frontend.md §9). El mensaje es solo el nombre del evento: ningún dato de la persona ni de
 * la sesión viaja por el canal. Sin `BroadcastChannel` no se hace nada (no hay respaldo con
 * `storage`: escribiría en el almacenamiento del navegador).
 */
export const SESSION_CHANNEL = 'iam.session';
export const SESSION_ENDED_EVENT = 'session.ended';

// Un solo canal compartido mientras haya oyentes: un canal no recibe sus propios mensajes, pero
// otra instancia de la MISMA pestaña sí, y la pestaña que cierra la sesión no debe reaccionar.
let shared: BroadcastChannel | undefined;
const listeners = new Set<() => void>();

const supported = () => typeof BroadcastChannel !== 'undefined';

/** Avisa a las demás pestañas de que la sesión terminó (cierre voluntario o sesión perdida). */
export function announceSessionEnded(): void {
  if (!supported()) return;
  const channel = shared ?? new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage(SESSION_ENDED_EVENT);
  if (channel !== shared) channel.close();
}

/** Escucha el fin de sesión provocado en OTRA pestaña. Devuelve la función que deja de escuchar. */
export function onSessionEndedElsewhere(listener: () => void): () => void {
  if (!supported()) return () => undefined;
  listeners.add(listener);
  if (shared === undefined) {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    // Solo se acepta el nombre exacto del evento: cualquier otro mensaje se ignora.
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === SESSION_ENDED_EVENT) for (const notify of listeners) notify();
    };
    shared = channel;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      shared?.close();
      shared = undefined;
    }
  };
}
