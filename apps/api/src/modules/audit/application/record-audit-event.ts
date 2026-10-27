/**
 * Invariantes de seguridad
 * - Se invoca dentro de la MISMA transacción que la acción auditada: si falla, la acción falla.
 * - La organización siempre sale del `RequestContext`, nunca del llamador.
 * - Los metadatos pasan por la lista blanca; no se aceptan campos libres.
 * - El hash y la secuencia los asigna la base de datos; esta capa nunca los calcula.
 */
import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { IdGenerator, RequestContextReader, Result } from '../../../shared/kernel/index.js';
import { sanitizeMetadata } from '../domain/audit-actions.js';
import type { AuditEvent, AuditEventInput } from '../domain/audit-event.js';
import type { AuditEventRepository } from './ports/audit-event-repository.js';

/** Contrato que consumen los demás módulos (a través de la fachada). */
export interface AuditLog {
  record(input: AuditEventInput): Promise<Result<AuditEvent, DomainError>>;
}

export interface RecordAuditEventDeps {
  readonly repository: AuditEventRepository;
  readonly context: RequestContextReader;
  readonly ids: IdGenerator;
}

export class RecordAuditEvent implements AuditLog {
  constructor(private readonly deps: RecordAuditEventDeps) {}

  async record(input: AuditEventInput): Promise<Result<AuditEvent, DomainError>> {
    const { repository, context, ids } = this.deps;
    if (input.outcome === 'denied' && (input.reasonCode === null || input.reasonCode === '')) {
      // Un patrón de negaciones es una señal de abuso: sin código de motivo no se puede agrupar.
      return err(new DomainError('AUDIT.REASON_CODE_REQUIRED', 'A denial needs a reason code'));
    }
    let metadata;
    try {
      metadata = sanitizeMetadata(input.action, input.metadata);
    } catch (error) {
      // Solo se convierten en resultado los errores esperados del dominio.
      if (error instanceof DomainError) return err(error);
      throw error;
    }
    const { organizationId } = context.current();
    const event = await repository.append({ ...input, metadata, id: ids.next(), organizationId });
    return ok(event);
  }
}
