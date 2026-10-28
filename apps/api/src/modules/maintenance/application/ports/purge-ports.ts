import type { OrganizationId } from '../../../../shared/kernel/index.js';

/** Recorrido de organizaciones para el trabajo de fondo (ADR 0038): solo identificadores. */
export interface OrganizationLister {
  listIds(): Promise<readonly OrganizationId[]>;
}

/**
 * Borra filas efímeras vencidas de la organización en curso (la transacción ya trae `app.org_id`).
 * Cada llamada borra como máximo `limit` filas y devuelve cuántas borró.
 */
export interface ExpiredEphemeralStore {
  purgeIdempotencyKeys(expiredBefore: Date, limit: number): Promise<number>;
  purgeWebauthnChallenges(expiredBefore: Date, limit: number): Promise<number>;
}
