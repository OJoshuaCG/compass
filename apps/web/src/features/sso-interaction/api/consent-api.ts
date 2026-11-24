import { z } from 'zod';

const consentSchema = z.object({
  clientName: z.string(),
  scopes: z.array(z.string()),
});
export type ConsentRequest = z.infer<typeof consentSchema>;

export type ConsentLoadResult = { kind: 'ready'; consent: ConsentRequest } | { kind: 'expired' };
export type ConsentDecision = 'allow' | 'deny';

const HTTP_BAD_REQUEST = 400;

/** Ruta del proveedor OIDC: no cuelga de `/api/v1`, por eso no usa el cliente HTTP de la API. */
const interactionPath = (uid: string) => `/oidc/interaction/${encodeURIComponent(uid)}`;

/**
 * Datos de la solicitud de consentimiento. El proveedor responde 400 genérico cuando la
 * interacción venció o ya no aplica: es un estado esperado (`expired`), no un fallo. Cualquier
 * otra cosa (5xx, red, cuerpo inesperado) lanza para que la pantalla ofrezca reintentar.
 */
export async function loadConsent(uid: string, signal: AbortSignal): Promise<ConsentLoadResult> {
  const response = await fetch(`${interactionPath(uid)}/consent`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (response.status === HTTP_BAD_REQUEST) return { kind: 'expired' };
  if (!response.ok)
    throw new Error(`Consent request failed with status ${String(response.status)}`);
  return { kind: 'ready', consent: consentSchema.parse(await response.json()) };
}

/**
 * Envía la decisión. El servidor responde 303 a `/oidc/auth/<uid>`; con `redirect: 'manual'` el
 * navegador entrega una respuesta `opaqueredirect`, que es la señal de éxito (no se puede leer su
 * destino y tampoco hace falta: la navegación de página completa la hace la pantalla). Sin
 * cuerpo ni cabeceras propias: el navegador agrega `Origin` solo, que es lo que valida el servidor.
 */
export async function submitConsentDecision(uid: string, decision: ConsentDecision): Promise<void> {
  const response = await fetch(`${interactionPath(uid)}/consent/${decision}`, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
  });
  if (response.type !== 'opaqueredirect') {
    throw new Error(`Consent decision failed with status ${String(response.status)}`);
  }
}
