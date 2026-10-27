import type { AuditEventRepository } from '../application/ports/audit-event-repository.js';
import type { AuditEvent, NewAuditEvent } from '../domain/audit-event.js';

/** Doble de prueba para los casos de uso; la cadena real se prueba contra PostgreSQL. */
export class InMemoryAuditEventRepository implements AuditEventRepository {
  readonly events: AuditEvent[] = [];
  failNextAppend = false;
  brokenSeq: bigint | null = null;

  append(event: NewAuditEvent): Promise<AuditEvent> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      return Promise.reject(new Error('audit storage unavailable'));
    }
    const stored: AuditEvent = {
      ...event,
      seq: BigInt(this.events.length + 1),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      prevHash: this.events.at(-1)?.hash ?? '00'.repeat(32),
      hash: `fake-${String(this.events.length + 1)}`,
    };
    this.events.push(stored);
    return Promise.resolve(stored);
  }

  firstBrokenSeq(): Promise<bigint | null> {
    return Promise.resolve(this.brokenSeq);
  }
}
