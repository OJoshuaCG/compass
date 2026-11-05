import type { IntegrationSecretField } from '../../domain/integration-secret-context.js';

export interface StaleIntegrationSecret {
  readonly integrationId: string;
  readonly field: IntegrationSecretField;
  readonly secretVersion: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}

/**
 * Acceso al texto cifrado de los secretos de las integraciones para el recifrado (ADR 0040). Todo
 * corre en la transacción en curso, con la organización fijada. Nunca descifra ni devuelve valores
 * en claro.
 */
export interface IntegrationSecretStore {
  /**
   * Bloquea (saltando las ya bloqueadas) hasta `limit` secretos con DEK anterior a la activa, en orden
   * de (integración, campo). `afterCursor` es el valor que devolvió el lote anterior; una cadena
   * mal formada se rechaza con un error en lugar de reiniciar el recorrido.
   */
  lockSecretsBelowVersion(
    activeVersion: number,
    limit: number,
    afterCursor: string | null,
  ): Promise<readonly StaleIntegrationSecret[]>;
  /**
   * Reemplaza el texto cifrado solo si nadie lo cambió antes: exige la misma versión de DEK y la
   * misma `secretVersion` (que forma parte del contexto de cifrado). `false` = conflicto. No toca
   * `rotated_at`: recifrar no es una rotación hecha por una persona.
   */
  replaceSecret(input: {
    readonly integrationId: string;
    readonly field: IntegrationSecretField;
    readonly expectedDekVersion: number;
    readonly expectedSecretVersion: number;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<boolean>;
  countSecretsBelowVersion(activeVersion: number): Promise<number>;
}
