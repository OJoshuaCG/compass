export interface StaleMailPassword {
  readonly sourceId: string;
  readonly secretVersion: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}

/**
 * Acceso a la contraseña cifrada de las conexiones de buzón para el recifrado (ADR 0040). Todo corre
 * en la transacción en curso, con la organización fijada.
 */
export interface MailConnectionSecretStore {
  /** Bloquea (saltando las ya bloqueadas) hasta `limit` contraseñas con DEK anterior a la activa, en orden de fuente. */
  lockPasswordsBelowVersion(
    activeVersion: number,
    limit: number,
    afterSourceId: string | null,
  ): Promise<readonly StaleMailPassword[]>;
  /**
   * Reemplaza el texto cifrado solo si nadie lo cambió antes: exige la misma versión de DEK y la
   * misma `secretVersion` (que forma parte del contexto de cifrado). `false` = conflicto.
   */
  replacePassword(input: {
    readonly sourceId: string;
    readonly expectedDekVersion: number;
    readonly expectedSecretVersion: number;
    readonly ciphertext: Uint8Array;
    readonly nonce: Uint8Array;
    readonly dekVersion: number;
  }): Promise<boolean>;
  countPasswordsBelowVersion(activeVersion: number): Promise<number>;
}
