import type { AuditEvent, NewAuditEvent } from '../../domain/audit-event.js';

/**
 * Almacén de auditoría. Ambas operaciones corren en la transacción en curso (`UnitOfWork`),
 * con la organización fijada por RLS: así la escritura comparte destino con la acción auditada.
 */
export interface AuditEventRepository {
  /** Inserta y devuelve el evento ya encadenado por la base de datos. */
  append(event: NewAuditEvent): Promise<AuditEvent>;
  /** `seq` del primer evento que rompe la cadena de la organización en curso, o `null` si está íntegra. */
  firstBrokenSeq(): Promise<bigint | null>;
}
