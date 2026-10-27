import { z } from 'zod';

/**
 * Puente con `@simplewebauthn/browser`. La biblioteca solo se descarga cuando una ceremonia
 * empieza (`import()` dinámico): así queda fuera del JavaScript inicial (docs/frontend.md §12).
 *
 * Se importa por su ruta y no por el índice de `shared/lib`, igual que `use-lazy-catalog`.
 * Nada de lo que pasa por aquí (opciones, atestaciones, aserciones) se guarda: son datos de un
 * solo uso que viven en variables locales de la ceremonia (docs/frontend.md §9).
 */
/**
 * Opciones de una ceremonia WebAuthn en JSON. El servidor las genera con la biblioteca de WebAuthn
 * y el navegador las valida al usarlas; aquí solo se exige que sea un objeto con `challenge`.
 * El llamador las tipa con `PublicKeyCredential*OptionsJSON` (solo tipos: no arrastra la biblioteca).
 */
export const webauthnOptionsSchema = z.looseObject({ challenge: z.string().min(1) });

export function loadWebAuthn() {
  return import('@simplewebauthn/browser');
}

/**
 * La persona cerró o rechazó la solicitud del navegador (o venció). No es un fallo del servidor
 * ni algo que haya que reportar como error: la pantalla solo lo avisa en neutro.
 */
export function isCeremonyCancelled(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}

/** El autenticador ya tiene una credencial de esta cuenta (solo ocurre al registrar). */
export function isAlreadyRegistered(error: unknown): boolean {
  return error instanceof Error && error.name === 'InvalidStateError';
}
