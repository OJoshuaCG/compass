/**
 * Invariantes de seguridad
 * - Solo inserta: el rol de la aplicación no tiene UPDATE ni DELETE sobre `audit_events`.
 * - Los marcadores de `seq`, hashes y `created_at` se sobrescriben en el trigger de la base de
 *   datos; el hash y la secuencia nunca los decide la aplicación.
 * - Corre siempre en la transacción en curso, con `app.org_id` fijado por el `UnitOfWork`.
 */
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import type { TransactionProvider } from '../../organization/index.js';
import { asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { AuditEventRepository } from '../application/ports/audit-event-repository.js';
import type { AuditEvent, AuditOutcome, NewAuditEvent } from '../domain/audit-event.js';
import { auditEvents } from './schema.js';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

export class PgAuditEventRepository implements AuditEventRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async append(event: NewAuditEvent): Promise<AuditEvent> {
    const db = drizzle({ client: this.transactions.current() });
    const [row] = await db
      .insert(auditEvents)
      .values({
        id: event.id,
        organizationId: event.organizationId,
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
        ip: event.ip,
        requestId: event.requestId,
        metadata: event.metadata,
        // Marcadores: el trigger de la base de datos los reemplaza (ver cabecera).
        seq: sql`0`,
        prevHash: sql`'\\x'::bytea`,
        hash: sql`'\\x'::bytea`,
        createdAt: sql`now()`,
      })
      .returning();
    if (row === undefined) throw new Error('Audit insert returned no row');
    return {
      id: row.id,
      organizationId: asOrganizationId(row.organizationId),
      seq: row.seq,
      actorId: row.actorId === null ? null : asUserId(row.actorId),
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      outcome: row.outcome as AuditOutcome,
      reasonCode: row.reasonCode,
      ip: row.ip,
      requestId: row.requestId ?? event.requestId,
      metadata: row.metadata,
      prevHash: toHex(row.prevHash),
      hash: toHex(row.hash),
      createdAt: row.createdAt,
    };
  }

  async firstBrokenSeq(): Promise<bigint | null> {
    const db = drizzle({ client: this.transactions.current() });
    const result = await db.execute<{ seq: string | null }>(
      sql`select audit_verify_chain() as seq`,
    );
    const value = result.rows[0]?.seq ?? null;
    return value === null ? null : BigInt(value);
  }
}

/** Reexportado para pruebas que consultan el almacén directamente. */
export { auditEvents, eq };
