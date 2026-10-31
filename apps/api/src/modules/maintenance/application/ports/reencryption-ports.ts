import type { OrganizationId } from '../../../../shared/kernel/index.js';

export interface ReencryptionBatchResult {
  /** Secretos que pasaron a la versión activa de la DEK. */
  readonly resealed: number;
  /** Secretos que otra escritura modificó a la vez: se reintentan en el siguiente pase. */
  readonly conflicts: number;
  /** Secretos que no se pudieron abrir (nunca se registra su contenido ni la causa detallada). */
  readonly failed: number;
  /** Filas que el lote tomó, hayan o no cambiado; 0 significa que el recorrido terminó. */
  readonly examined: number;
  /** Cursor para el siguiente lote; `null` si este no tomó ninguna fila. */
  readonly lastId: string | null;
}

/**
 * Un tipo de secreto cifrado que debe migrar a la DEK activa (ADR 0040). Cada módulo dueño del
 * dato implementa el suyo; el trabajo de mantenimiento solo los recorre. Se llama dentro de una
 * transacción ya abierta con la organización fijada.
 */
export interface SecretReencryptor {
  /** Nombre estable para el resumen del trabajo (nunca un dato de la persona). */
  readonly name: string;
  /** `afterId` es el cursor del lote anterior (`null` en el primero): evita volver a tomar las mismas filas. */
  reencryptBatch(
    organizationId: OrganizationId,
    limit: number,
    afterId: string | null,
  ): Promise<ReencryptionBatchResult>;
  /** Cuántos secretos de la organización siguen en una versión anterior a la activa. */
  countPending(organizationId: OrganizationId): Promise<number>;
}
