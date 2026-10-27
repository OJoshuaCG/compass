import { Pool } from 'pg';

import { loadConfig } from './app/config.js';
import { buildContainer } from './app/container.js';
import { createApp } from './app/create-app.js';
import { LocalKeyManagement } from './modules/crypto/index.js';
import { LogMailer } from './modules/notification/index.js';
import { createLogger } from './shared/infrastructure/logger.js';

const config = loadConfig(process.env);
const logger = createLogger({ level: config.LOG_LEVEL });
if (config.DATABASE_URL === undefined) throw new Error('DATABASE_URL is required');

const container = buildContainer({
  pool: new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX }),
  independentPool: new Pool({ connectionString: config.DATABASE_URL, max: 2 }),
  // Solo desarrollo: en producción se usa el adaptador del KMS del proveedor (ADR 0020).
  kms: new LocalKeyManagement({ keyFilePath: config.LOCAL_KMS_KEY_FILE, nodeEnv: config.NODE_ENV }),
  mailer: new LogMailer(logger, config.APP_ORIGIN, config.NODE_ENV),
  logger,
});
const app = await createApp({
  logger,
  container,
  appOrigin: config.APP_ORIGIN,
  trustProxy: config.TRUST_PROXY,
});

// Apagado ordenado: dejar de aceptar peticiones, cerrar conexiones y borrar las DEK de memoria.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => container.shutdown())
      .then(() => {
        process.exit(0);
      });
  });
}

await app.listen(config.PORT, config.HOST);
logger.info({ host: config.HOST, port: config.PORT }, 'http server listening');
