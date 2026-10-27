/**
 * Invariantes de seguridad
 * - Toda transacción fija `app.org_id` con `set_config(..., true)` (equivale a SET LOCAL) ANTES
 *   de ejecutar nada: sin esa variable, RLS devuelve cero filas (falla cerrada).
 * - La organización sale del `RequestContext`, nunca de un argumento del llamador.
 * - No hay acceso a la base de datos fuera de una transacción: `current()` lanza si no hay una.
 * - Un fallo revierte la transacción completa; la conexión se libera siempre.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { Pool, PoolClient } from 'pg';

import { DomainError } from '../../../shared/kernel/index.js';
import type { RequestContextReader } from '../../../shared/kernel/index.js';
import type { UnitOfWork } from '../application/ports/unit-of-work.js';

/** Entrega la transacción en curso a los repositorios (que viven en `infrastructure`). */
export interface TransactionProvider {
  current(): PoolClient;
}

export class PgUnitOfWork implements UnitOfWork, TransactionProvider {
  private readonly active = new AsyncLocalStorage<PoolClient>();

  /**
   * @param independentPool Pool propio (pequeño) para `runIndependent`. Debe ser distinto de `pool`:
   *   si ambos fueran el mismo, N peticiones que sostienen una conexión cada una y piden una segunda
   *   agotarían el pool y se bloquearían entre sí (deadlock por inanición).
   */
  constructor(
    private readonly pool: Pool,
    private readonly context: RequestContextReader,
    private readonly independentPool: Pool,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Una llamada anidada se une a la transacción existente (misma organización por construcción).
    if (this.active.getStore() !== undefined) return fn();
    return this.open(this.pool, fn);
  }

  runIndependent<T>(fn: () => Promise<T>): Promise<T> {
    return this.open(this.independentPool, fn);
  }

  private async open<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
    const { organizationId } = this.context.current();
    const client = await pool.connect();
    // Si el rollback falla, la conexión ya es inservible: se destruye en lugar de devolverla al pool.
    let discard = false;
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [organizationId]);
      const result = await this.active.run(client, fn);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  current(): PoolClient {
    const client = this.active.getStore();
    if (client === undefined) {
      throw new DomainError('AUTHZ.TENANT', 'No active transaction: use UnitOfWork.run');
    }
    return client;
  }
}
