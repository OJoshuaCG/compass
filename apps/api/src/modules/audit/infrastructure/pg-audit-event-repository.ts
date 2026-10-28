/**
 * Invariantes de seguridad
 * - Solo inserta: el rol de la aplicación no tiene UPDATE ni DELETE sobre `audit_events`.
 * - Los marcadores de `seq`, hashes y `created_at` se sobrescriben en el trigger de la base de
 *   datos; el hash y la secuencia nunca los decide la aplicación.
 * - Corre siempre en la transacción en curso, con `app.org_id` fijado por el `UnitOfWork`.
 * - Falla cerrada (ADR 0023): si el bloqueo de la cadena no se obtiene dentro de `lock_timeout`, la
 *   transacción completa se revierte con `AUDIT.LOCK_TIMEOUT` y la acción no se ejecuta.
 */
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';

import type { TransactionProvider } from '../../organization/index.js';
import { DomainError, asOrganizationId, asUserId } from '../../../shared/kernel/index.js';
import type { AuditEventRepository } from '../application/ports/audit-event-repository.js';
import type { AuditEvent, AuditOutcome, NewAuditEvent } from '../domain/audit-event.js';
import { auditEvents } from './schema.js';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Tiempo máximo de espera del bloqueo de la cadena por organización (ADR 0023). */
export const AUDIT_LOCK_TIMEOUT_MS = 5000;

/** SQLSTATE de PostgreSQL cuando un bloqueo no se obtiene dentro de `lock_timeout`. */
const LOCK_NOT_AVAILABLE = '55P03';

/** Drizzle envuelve el error del controlador: el SQLSTATE puede venir directo o en `cause`. */
const isLockNotAvailable = (error: unknown): boolean => {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) => (candidate as { code?: string } | null | undefined)?.code === LOCK_NOT_AVAILABLE,
  );
};

export class PgAuditEventRepository implements AuditEventRepository {
  constructor(
    private readonly transactions: TransactionProvider,
    private readonly lockTimeoutMs: number = AUDIT_LOCK_TIMEOUT_MS,
  ) {}

  async append(event: NewAuditEvent): Promise<AuditEvent> {
    const client = this.transactions.current();
    // El bloqueo se toma en el trigger del INSERT. El límite es local a la transacción y no se
    // restablece: por convención (ADR 0023) el evento es lo último que escribe el caso de uso; si algo
    // esperara un bloqueo después, heredaría estos segundos y su 55P03 no se traduciría a AUDIT.LOCK_TIMEOUT.
    await client.query("select set_config('lock_timeout', $1, true)", [
      `${String(this.lockTimeoutMs)}ms`,
    ]);
    const db = drizzle({ client });
    const insert = db
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
    let row: Awaited<typeof insert>[number] | undefined;
    try {
      [row] = await insert;
    } catch (error) {
      if (isLockNotAvailable(error)) {
        throw new DomainError(
          'AUDIT.LOCK_TIMEOUT',
          'The audit chain lock was not acquired in time; the action was not performed',
          {},
          { cause: error },
        );
      }
      throw error;
    }
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
