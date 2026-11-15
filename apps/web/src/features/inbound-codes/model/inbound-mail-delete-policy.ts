import type { InboundMailDeleteStatusResponse } from '@iam/contracts';

/** Cada cuánto se consulta el estado mientras la petición sigue pendiente. El worker pasa cada minuto. */
export const MAIL_DELETE_POLL_INTERVAL_MS = 5_000;

/**
 * Tope de la espera activa: pasado este tiempo se deja de consultar y se avisa que sigue pendiente.
 * Son tres pasadas del worker; más allá probablemente el worker no está corriendo y consultar no ayuda.
 */
export const MAIL_DELETE_POLL_MAX_MS = 180_000;

export type MailDeleteState = NonNullable<InboundMailDeleteStatusResponse['data']>;

/** Una petición terminada (borrada o fallida) ya no cambia: no hace falta seguir consultando. */
export function isMailDeleteSettled(state: MailDeleteState | null | undefined): boolean {
  return state?.status === 'done' || state?.status === 'failed';
}

/** Solo se ofrece pedir el borrado si nunca se pidió o si el intento anterior falló. */
export function canRequestMailDelete(state: MailDeleteState | null | undefined): boolean {
  return state === null || state === undefined || state.status === 'failed';
}

/**
 * Comodidad de la interfaz: el servidor decide (permiso, Administrador o creador de la fuente,
 * reautenticación); aquí solo no se ofrece lo que ya se sabe que no procede.
 */
export function canOfferMailDelete(
  hasPermission: boolean,
  level: string | undefined,
  canManageMail: boolean | undefined,
): boolean {
  return hasPermission && level === 'MANAGE' && canManageMail === true;
}
