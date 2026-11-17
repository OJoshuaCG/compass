import type { CredentialHealthFacts } from '../../domain/credential-health.js';

/**
 * Lee los hechos de salud de las credenciales. Todo corre en la transacción en curso, con la organización
 * fijada por RLS. Solo devuelve puntajes, fechas y estados: nunca texto cifrado ni huellas.
 */
export interface CredentialHealthReader {
  /** Credenciales no archivadas de la cuenta, por etiqueta. */
  factsByAccount(accountId: string): Promise<readonly CredentialHealthFacts[]>;
  /**
   * Credenciales no archivadas de las cuentas activas compartidas con el grupo (compartición vigente: sin
   * revocar y sin vencer en `now`).
   */
  factsByGroup(groupId: string, now: Date): Promise<readonly CredentialHealthFacts[]>;
  /** Credenciales no archivadas de todas las cuentas activas de la organización. */
  factsByOrganization(): Promise<readonly CredentialHealthFacts[]>;
}
