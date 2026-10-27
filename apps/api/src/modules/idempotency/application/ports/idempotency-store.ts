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
  /** Toma una reserva vencida (la petición original murió sin terminar o ya pasó el plazo). */
  takeOver(input: {
    readonly actorId: UserId;
    readonly key: string;
    readonly requestHash: string;
    readonly expiresAt: Date;
  }): Promise<void>;
  complete(input: {
    readonly actorId: UserId;
    readonly key: string;
    readonly statusCode: number;
    readonly body: unknown;
    readonly expiresAt: Date;
  }): Promise<void>;
  release(actorId: UserId, key: string): Promise<void>;
}
