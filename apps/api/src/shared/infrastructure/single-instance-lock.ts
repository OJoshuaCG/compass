import { Client } from 'pg';

/**
 * Clave del candado consultivo de PostgreSQL que identifica "una API viva contra esta base".
 * Es un número fijo y arbitrario: solo debe ser el mismo en todas las instancias y no chocar con
 * otro uso de candados consultivos en la misma base (la migración usa otra clave).
 */
export const SINGLE_INSTANCE_LOCK_KEY = 208_020_001;

const GUARD_APPLICATION_NAME = 'iam-api-single-instance-guard';

/** Cada cuánto se comprueba que la conexión sigue sosteniendo el candado. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/** Una comprobación que tarda más se da por fallida: la conexión está muerta o colgada. */
const HEARTBEAT_QUERY_TIMEOUT_MS = 5_000;

/** Otra instancia de la API ya sostiene el candado de esta base de datos (ADR 0039). */
export class SecondInstanceError extends Error {
  readonly code = 'RUNTIME.SECOND_INSTANCE';

  constructor() {
    // El mensaje no incluye la cadena de conexión: es configuración con credenciales.
    super('another API instance already holds the single-instance lock for this database');
    this.name = 'SecondInstanceError';
  }
}

/**
 * La base respondió que el candado es nuestro, pero la propia sesión no lo figura como suyo. Pasa
 * detrás de un balanceador de conexiones en modo transacción (PgBouncer): el candado de sesión no
 * pertenece a nuestra conexión y no protege nada. Se rechaza el arranque en vez de fingir protección.
 */
export class LockUnverifiableError extends Error {
  readonly code = 'RUNTIME.LOCK_UNVERIFIABLE';

  constructor() {
    super(
      'the single-instance lock could not be verified on the guard connection; DATABASE_URL must be a direct PostgreSQL connection',
    );
    this.name = 'LockUnverifiableError';
  }
}

export type SingleInstanceLock = {
  /** Suelta el candado cerrando la conexión que lo sostiene. Idempotente. */
  release: () => Promise<void>;
};

export type SingleInstanceLockOptions = {
  connectionString: string;
  /**
   * Se llama una sola vez si el candado deja de estar garantizado (la conexión se cierra, falla o
   * el candado ya no figura como nuestro) sin haberlo soltado. Sin él PostgreSQL permite que una
   * segunda instancia arranque, así que quien llama debe tratarlo como fatal.
   */
  onLockLost: () => void;
  heartbeatIntervalMs?: number;
  /** Solo para pruebas: permite conservar la conexión y provocar la pérdida del candado. */
  createClient?: (config: { connectionString: string }) => Client;
};

/** ¿Figura el candado como concedido a esta misma sesión? (`pg_locks` parte la clave en dos mitades). */
async function sessionHoldsLock(client: Client): Promise<boolean> {
  const result = await client.query<{ held: boolean }>(
    `select exists (
       select 1 from pg_locks
        where locktype = 'advisory'
          and granted
          and pid = pg_backend_pid()
          and objsubid = 1
          and ((classid::bigint << 32) | objid::bigint) = $1::bigint
     ) as held`,
    [SINGLE_INSTANCE_LOCK_KEY],
  );
  return result.rows[0]?.held === true;
}

/**
 * Hace cumplir la decisión de instancia única (ADR 0039, TODO J1): los contadores de intentos y el
 * límite por IP viven en memoria, así que dos instancias contra la misma base duplicarían los
 * intentos permitidos a quien ataca y un reinicio superpuesto dividiría los contadores.
 *
 * Toma un candado consultivo de sesión sobre una conexión dedicada que vive tanto como el proceso.
 * Falla rápido con `SecondInstanceError` si otra instancia ya lo tiene. No usa el pool de la
 * aplicación: un candado de sesión en una conexión que el pool reutiliza se perdería o se filtraría.
 * Un latido periódico detecta la conexión semiabierta (corte de red sin cierre), que no emite
 * ningún evento y dejaría a otra instancia arrancar mientras esta cree seguir protegida.
 */
export async function acquireSingleInstanceLock(
  options: SingleInstanceLockOptions,
): Promise<SingleInstanceLock> {
  const clientConfig = { connectionString: options.connectionString };
  const client =
    options.createClient?.(clientConfig) ??
    new Client({
      ...clientConfig,
      application_name: GUARD_APPLICATION_NAME,
      keepAlive: true,
      query_timeout: HEARTBEAT_QUERY_TIMEOUT_MS,
    });

  // Durante el arranque un error de conexión se propaga por `connect`/`query`; el oyente solo evita
  // que el evento `error` sin oyente tumbe el proceso con un mensaje que no es el nuestro.
  client.on('error', () => undefined);

  let closed = false;
  let lockLostReported = false;
  let heartbeat: NodeJS.Timeout | undefined;

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const reportLockLost = (): void => {
    if (closed || lockLostReported) return;
    lockLostReported = true;
    stopHeartbeat();
    options.onLockLost();
  };

  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1::bigint) as locked',
      [SINGLE_INSTANCE_LOCK_KEY],
    );
    if (result.rows[0]?.locked !== true) throw new SecondInstanceError();
    if (!(await sessionHoldsLock(client))) throw new LockUnverifiableError();
  } catch (error) {
    closed = true;
    await client.end().catch(() => undefined);
    throw error;
  }

  // Solo desde aquí la pérdida de la conexión significa "candado perdido".
  client.on('error', reportLockLost);
  client.on('end', reportLockLost);

  let checking = false;
  heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    sessionHoldsLock(client)
      .then((held) => {
        if (!held) reportLockLost();
      })
      .catch(reportLockLost)
      .finally(() => {
        checking = false;
      });
  }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    release: async () => {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      await client.end();
    },
  };
}
