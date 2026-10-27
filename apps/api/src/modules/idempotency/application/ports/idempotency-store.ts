import type { UserId } from '../../../../shared/kernel/index.js';

export interface StoredResponse {
  readonly requestHash: string;
  /** `null` mientras la petición original sigue en curso. */
  readonly statusCode: number | null;
  readonly body: unknown;
  readonly expiresAt: Date;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface IdempotencyStore {
  /** Reserva la clave; `false` si ya existía (para ese actor). */
  reserve(input: {
    readonly actorId: UserId;
    readonly key: string;
    readonly requestHash: string;
    readonly expiresAt: Date;
  }): Promise<boolean>;
  find(actorId: UserId, key: string): Promise<StoredResponse | null>;
  /**
   * Toma una reserva vencida de forma atómica; `false` si otra petición la tomó antes o ya no está
   * vencida (así solo una de varias reintentando puede continuar).
   */
  takeOver(input: {
    readonly actorId: UserId;
    readonly key: string;
    readonly requestHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
  }): Promise<boolean>;
  /**
   * Guarda la respuesta solo si la reserva sigue siendo de quien llama (`reservedUntil` identifica
   * su reserva): una petición lenta, ya reemplazada por otra, no pisa a la nueva dueña.
   */
  complete(input: {
    readonly actorId: UserId;
    readonly key: string;
    readonly reservedUntil: Date;
    readonly statusCode: number;
    readonly body: unknown;
    readonly expiresAt: Date;
  }): Promise<void>;
  /** Libera la reserva propia (la petición falló), con la misma condición de dueña. */
  release(actorId: UserId, key: string, reservedUntil: Date): Promise<void>;
}
