/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita cada sentencia a la organización fijada.
 * - Nunca toca `payload` más que para leerlo y entregarlo al manejador.
 * - Cuarentena (dead letter) = sin publicar y con `next_attempt_at = 'infinity'`: el esquema no
 *   tiene columna de estado y la consulta de reclamo (`next_attempt_at <= now`) jamás la recoge.
 *   Inspección: `select ... from outbox_events where published_at is null and next_attempt_at = 'infinity'`.
 * - Un tipo sin manejador NO entra en cuarentena: se pospone sin contar intentos (`deferWithoutAttempt`).
 */
import type { TransactionProvider } from '../../organization/index.js';
import { asOrganizationId } from '../../../shared/kernel/index.js';
import type { OutboxRepository } from '../application/ports/outbox-repository.js';
import type { OutboxEvent } from '../domain/outbox-event.js';

interface OutboxRow {
  id: string;
  organization_id: string;
  aggregate: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export class PgOutboxRepository implements OutboxRepository {
  constructor(private readonly transactions: TransactionProvider) {}

  async claimNext(now: Date): Promise<OutboxEvent | null> {
    // Orden por vencimiento y luego por id (UUIDv7): casi FIFO, y usa el índice parcial de pendientes.
    const result = await this.transactions.current().query<OutboxRow>(
      `select id, organization_id, aggregate, type, payload, attempts
         from outbox_events
        where published_at is null and next_attempt_at <= $1
        order by next_attempt_at, id
        limit 1
        for update skip locked`,
      [now],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      organizationId: asOrganizationId(row.organization_id),
      aggregate: row.aggregate,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts,
    };
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await this.transactions
      .current()
      .query('update outbox_events set published_at = $2 where id = $1', [eventId, publishedAt]);
  }

  async scheduleRetry(eventId: string, failedAttempts: number, nextAttemptAt: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        'update outbox_events set attempts = $2, next_attempt_at = $3 where id = $1 and published_at is null',
        [eventId, failedAttempts, nextAttemptAt],
      );
  }

  async deferWithoutAttempt(eventId: string, nextAttemptAt: Date): Promise<void> {
    // `attempts` no se toca a propósito: un tipo sin manejador no es un fallo del manejador.
    await this.transactions
      .current()
      .query(
        'update outbox_events set next_attempt_at = $2 where id = $1 and published_at is null',
        [eventId, nextAttemptAt],
      );
  }

  async markDeadLettered(eventId: string, failedAttempts: number): Promise<void> {
    await this.transactions
      .current()
      .query(
        "update outbox_events set attempts = $2, next_attempt_at = 'infinity' where id = $1 and published_at is null",
        [eventId, failedAttempts],
      );
  }
}
