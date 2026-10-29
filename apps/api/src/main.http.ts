import { Pool } from 'pg';

import { loadConfig } from './app/config.js';
import { buildContainer } from './app/container.js';
import { createApp } from './app/create-app.js';
import { createKeyManagement } from './app/key-management.js';
import { LogMailer, SmtpMailer } from './modules/notification/index.js';
import { createLogger } from './shared/infrastructure/logger.js';
import {
  acquireSingleInstanceLock,
  LockUnverifiableError,
  SecondInstanceError,
} from './shared/infrastructure/single-instance-lock.js';

const config = loadConfig(process.env);
const logger = createLogger({ level: config.LOG_LEVEL });
if (config.DATABASE_URL === undefined) throw new Error('DATABASE_URL is required');

// Instancia única (ADR 0039): se toma antes que cualquier otra cosa y falla rápido si ya hay otra.
const singleInstanceLock = await acquireSingleInstanceLock({
  connectionString: config.DATABASE_URL,
  onLockLost: () => {
    // Sin el candado otra instancia podría arrancar y los límites de intentos dejarían de valer.
    logger.fatal('single-instance lock lost, stopping the API');
    process.exit(1);
  },
}).catch((error: unknown) => {
  if (error instanceof SecondInstanceError || error instanceof LockUnverifiableError) {
    logger.fatal({ code: error.code }, error.message);
  } else {
    // No se vuelca el error de conexión: podría arrastrar datos de la configuración.
    logger.fatal('could not acquire the single-instance lock, check DATABASE_URL and the database');
  }
  process.exit(1);
});

const appOrigin = new URL(config.APP_ORIGIN);

const container = buildContainer({
  webauthn: {
    rpName: config.WEBAUTHN_RP_NAME,
    rpId: appOrigin.hostname,
    origin: appOrigin.origin,
  },
  pool: new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX }),
  independentPool: new Pool({ connectionString: config.DATABASE_URL, max: 2 }),
  // El adaptador local es solo de desarrollo; en producción la configuración exige AWS KMS (ADR 0020).
  kms: createKeyManagement(config),
  mailer:
    config.MAIL_TRANSPORT === 'smtp'
      ? new SmtpMailer(
          {
            host: config.SMTP_HOST ?? '',
            port: config.SMTP_PORT,
            security: config.SMTP_SECURITY,
            user: config.SMTP_USER,
            password: config.SMTP_PASSWORD,
            from: config.MAIL_FROM ?? '',
            baseUrl: config.APP_ORIGIN,
          },
          config.NODE_ENV,
        )
      : new LogMailer(logger, config.APP_ORIGIN, config.NODE_ENV),
  logger,
  outboxPollIntervalMs: config.OUTBOX_POLL_INTERVAL_MS,
});
const app = await createApp({
  logger,
  container,
  appOrigin: config.APP_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  ...(config.WEB_DIST_DIR === undefined ? {} : { webDistDir: config.WEB_DIST_DIR }),
});

// Apagado ordenado: dejar de aceptar peticiones, cerrar conexiones y borrar las DEK de memoria.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => container.shutdown())
      .then(() => singleInstanceLock.release())
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        // Un apagado que falla no debe dejar el proceso colgado conservando el candado.
        logger.error('graceful shutdown failed, exiting');
        process.exit(1);
      });
  });
}

await app.listen(config.PORT, config.HOST);
if (config.OUTBOX_WORKER_ENABLED) {
  container.outboxPoller.start();
  logger.info({ intervalMs: config.OUTBOX_POLL_INTERVAL_MS }, 'outbox worker started');
}
logger.info({ host: config.HOST, port: config.PORT }, 'http server listening');
