import type { ChainVerification } from '../domain/audit-event.js';
import type { AuditEventRepository } from './ports/audit-event-repository.js';

/**
 * Lo ejecuta un job diario por organización (dentro de su contexto); una ruptura dispara una
 * alerta crítica. Límite conocido: borrar los eventos más recientes no se detecta aquí; lo ancla
 * la exportación periódica a almacenamiento inmutable (plan: "Auditoría").
 */
export class VerifyAuditChain {
  constructor(private readonly deps: { readonly repository: AuditEventRepository }) {}

  async execute(): Promise<ChainVerification> {
    const firstBrokenSeq = await this.deps.repository.firstBrokenSeq();
    return firstBrokenSeq === null ? { valid: true } : { valid: false, firstBrokenSeq };
  }
}
