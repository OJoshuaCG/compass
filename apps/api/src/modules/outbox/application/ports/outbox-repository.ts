import type { OutboxEvent } from '../../domain/outbox-event.js';

/**
 * Acceso a `outbox_events` DENTRO de la transacción en curso: ya trae `app.org_id`, así que solo
 * ve y modifica eventos de esa organización.
 */
export interface OutboxRepository {
  /**
   * Toma y bloquea el siguiente evento pendiente y vencido (`FOR UPDATE SKIP LOCKED`), o `null`.
   * Un segundo reclamante concurrente se salta el evento bloqueado en lugar de esperarlo.
   */
  claimNext(now: Date): Promise<OutboxEvent | null>;
  markPublished(eventId: string, publishedAt: Date): Promise<void>;
  scheduleRetry(eventId: string, failedAttempts: number, nextAttemptAt: Date): Promise<void>;
  /**
   * Pospone el evento SIN contar un intento: es para eventos que aún no tienen manejador y que no
   * deben acercarse a la cuarentena por algo que no es un fallo del manejador.
   */
  deferWithoutAttempt(eventId: string, nextAttemptAt: Date): Promise<void>;
  /** Deja el evento sin publicar y fuera de la cola de reintentos, para inspección humana. */
  markDeadLettered(eventId: string, failedAttempts: number): Promise<void>;
}
