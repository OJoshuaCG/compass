import type { CredentialHealthFacts } from '../../domain/credential-health.js';

/**
 * Lee los hechos de salud de las credenciales de una cuenta. Todo corre en la transacción en curso, con la
 * organización fijada por RLS. Solo devuelve puntajes, fechas y estados: nunca texto cifrado ni huellas.
 */
export interface CredentialHealthReader {
  /** Credenciales no archivadas de la cuenta, por etiqueta. */
  factsByAccount(accountId: string): Promise<readonly CredentialHealthFacts[]>;
}
