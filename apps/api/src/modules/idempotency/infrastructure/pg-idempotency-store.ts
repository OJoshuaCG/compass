/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: RLS limita las filas a la organización.
 * - Cada consulta filtra además por actor: la clave de una persona no sirve a otra.
 */
import type { UserId } from '../../../shared/kernel/index.js';
import type { TransactionProvider } from '../../organization/index.js';
import type { IdempotencyStore, StoredResponse } from '../application/ports/idempotency-store.js';

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async reserve(input: {
    actorId: UserId;
    key: string;
    requestHash: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const result = await this.transactions.current().query(
      `insert into idempotency_keys (organization_id, actor_id, key, request_hash, expires_at)
       values (nullif(current_setting('app.org_id', true), '')::uuid, $1, $2, decode($3, 'hex'), $4)
       on conflict (organization_id, actor_id, key) do nothing`,
      [input.actorId, input.key, input.requestHash, input.expiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async find(actorId: UserId, key: string): Promise<StoredResponse | null> {
    const result = await this.transactions.current().query<{
      request_hash: string;
      status_code: number | null;
      response: unknown;
      expires_at: Date;
    }>(
      `select encode(request_hash, 'hex') as request_hash, status_code, response, expires_at
         from idempotency_keys where actor_id = $1 and key = $2`,
      [actorId, key],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          requestHash: row.request_hash,
          statusCode: row.status_code,
          body: row.response,
          expiresAt: row.expires_at,
        };
  }

  async takeOver(input: {
    actorId: UserId;
    key: string;
    requestHash: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const result = await this.transactions.current().query(
      `update idempotency_keys
          set request_hash = decode($3, 'hex'), response = null, status_code = null, expires_at = $5
        where actor_id = $1 and key = $2 and expires_at <= $4`,
      [input.actorId, input.key, input.requestHash, input.now, input.expiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async complete(input: {
    actorId: UserId;
    key: string;
    reservedUntil: Date;
    statusCode: number;
    body: unknown;
    expiresAt: Date;
  }): Promise<void> {
    await this.transactions.current().query(
      `update idempotency_keys set response = $3::jsonb, status_code = $4, expires_at = $5
        where actor_id = $1 and key = $2 and status_code is null and expires_at = $6`,
      [
        input.actorId,
        input.key,
        JSON.stringify(input.body),
        input.statusCode,
        input.expiresAt,
        input.reservedUntil,
      ],
    );
  }

  async release(actorId: UserId, key: string, reservedUntil: Date): Promise<void> {
    await this.transactions
      .current()
      .query(
        'delete from idempotency_keys where actor_id = $1 and key = $2 and status_code is null and expires_at = $3',
        [actorId, key, reservedUntil],
      );
  }
}
