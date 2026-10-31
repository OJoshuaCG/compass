import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import {
  acquireSingleInstanceLock,
  SecondInstanceError,
} from '../src/shared/infrastructure/single-instance-lock.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

const GUARD_APPLICATION_NAME = 'iam-api-single-instance-guard';
const FAST_HEARTBEAT_MS = 50;

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
});

afterAll(async () => {
  await db.close();
});

const neverLost = (): void => {
  throw new Error('the lock must not be reported as lost');
};

async function countGuardConnections(): Promise<number> {
  const admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  try {
    const result = await admin.query<{ total: string }>(
      `select count(*) as total from pg_stat_activity
        where application_name = $1 and datname = current_database()`,
      [GUARD_APPLICATION_NAME],
    );
    return Number(result.rows[0]?.total);
  } finally {
    await admin.end();
  }
}

describe('single instance lock', () => {
  it('rejects a second instance against the same database and does not leak its connection', async () => {
    const first = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost: neverLost,
    });
    try {
      await expect(
        acquireSingleInstanceLock({ connectionString: db.appUrl, onLockLost: neverLost }),
      ).rejects.toBeInstanceOf(SecondInstanceError);
      // Solo debe quedar la conexión de la primera: la de la segunda se cerró al fallar.
      await vi.waitFor(async () => {
        expect(await countGuardConnections()).toBe(1);
      });
    } finally {
      await first.release();
    }
    await vi.waitFor(async () => {
      expect(await countGuardConnections()).toBe(0);
    });
  });

  it('lets a new instance start once the previous one released the lock', async () => {
    const first = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost: neverLost,
    });
    await first.release();
    // Soltar dos veces es inocuo: el apagado ordenado puede llamarlo más de una vez.
    await first.release();

    const second = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost: neverLost,
    });
    await second.release();
  });

  it('reports the lock as lost, once, when its connection is terminated', async () => {
    const onLockLost = vi.fn();
    const lock = await acquireSingleInstanceLock({ connectionString: db.appUrl, onLockLost });

    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
          where application_name = $1 and datname = current_database()
            and pid <> pg_backend_pid()`,
        [GUARD_APPLICATION_NAME],
      );
    } finally {
      await admin.end();
    }

    await vi.waitFor(() => {
      expect(onLockLost).toHaveBeenCalledTimes(1);
    });
    await lock.release();
  });

  it('detects through the heartbeat a lock that vanished without any connection event', async () => {
    const onLockLost = vi.fn();
    let guardClient: Client | undefined;
    const lock = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost,
      heartbeatIntervalMs: FAST_HEARTBEAT_MS,
      createClient: (config) => {
        guardClient = new Client({ ...config, application_name: GUARD_APPLICATION_NAME });
        return guardClient;
      },
    });

    // La conexión sigue abierta y no emite nada, pero el servidor ya no considera el candado nuestro:
    // es lo que ocurre con un corte de red que el cliente no percibe.
    await guardClient?.query('select pg_advisory_unlock_all()');

    await vi.waitFor(() => {
      expect(onLockLost).toHaveBeenCalledTimes(1);
    });
    await lock.release();
  });

  it('keeps the heartbeat quiet while the lock is held', async () => {
    const onLockLost = vi.fn();
    const lock = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost,
      heartbeatIntervalMs: FAST_HEARTBEAT_MS,
    });
    await new Promise((resolve) => setTimeout(resolve, FAST_HEARTBEAT_MS * 6));
    expect(onLockLost).not.toHaveBeenCalled();
    await lock.release();
  });

  it('does not report a lost lock after a deliberate release', async () => {
    const onLockLost = vi.fn();
    const lock = await acquireSingleInstanceLock({
      connectionString: db.appUrl,
      onLockLost,
      heartbeatIntervalMs: FAST_HEARTBEAT_MS,
    });
    await lock.release();
    await new Promise((resolve) => setTimeout(resolve, FAST_HEARTBEAT_MS * 4));
    expect(onLockLost).not.toHaveBeenCalled();
  });

  it('fails with the connection error, not a lost-lock report, when the database is unreachable', async () => {
    const onLockLost = vi.fn();
    const unreachable = new URL(db.appUrl);
    unreachable.port = '1';

    const attempt = acquireSingleInstanceLock({
      connectionString: unreachable.toString(),
      onLockLost,
    });

    await expect(attempt).rejects.not.toBeInstanceOf(SecondInstanceError);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onLockLost).not.toHaveBeenCalled();
  });
});
