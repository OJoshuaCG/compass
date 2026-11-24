/** Secreto de un cliente OIDC que sigue cifrado con una DEK anterior a la activa. */
export interface StaleOidcClientSecret {
  /** Id de la fila de `oidc_clients` (también ata el texto cifrado a su cliente, ver `clientSecretContext`). */
  readonly clientRowId: string;
  /** Valor empaquetado tal como está guardado (versión de DEK | nonce | texto cifrado). */
  readonly packedSecret: Uint8Array;
}

/**
 * Acceso al secreto cifrado de los clientes OIDC solo para la migración a la DEK activa (ADR 0040).
 * Se usa dentro de una transacción de lote con la organización fijada.
 */
export interface OidcClientSecretStore {
  /**
   * Toma y bloquea hasta `limit` secretos cuya versión de DEK es menor que la activa, en orden de id y
   * después de `afterId`. Incluye clientes deshabilitados: su secreto sigue cifrado con la DEK vieja.
   */
  lockSecretsBelowVersion(
    activeVersion: number,
    limit: number,
    afterId: string | null,
  ): Promise<readonly StaleOidcClientSecret[]>;

  /**
   * Reemplaza el secreto solo si sigue siendo el valor leído (otra rotación pudo cambiarlo).
   * Devuelve `false` si ya no coincide.
   */
  replaceSecretIfUnchanged(
    clientRowId: string,
    expectedPackedSecret: Uint8Array,
    newPackedSecret: Uint8Array,
  ): Promise<boolean>;

  /** Cuántos secretos de la organización siguen en una versión de DEK anterior a la activa. */
  countSecretsBelowVersion(activeVersion: number): Promise<number>;
}
