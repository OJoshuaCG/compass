import { migrate } from '@iam/db';

import { createLogger } from './shared/infrastructure/logger.js';

// Se ejecuta como paso previo al despliegue, con el rol de migraciones (nunca el de la aplicación).
const connectionString = process.env['MIGRATION_DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  throw new Error('MIGRATION_DATABASE_URL is required');
}

const logger = createLogger({ level: process.env['LOG_LEVEL'] ?? 'info' });
const result = await migrate({
  connectionString,
  log: (message) => {
    logger.info(message);
  },
});
logger.info({ applied: result.applied.length, skipped: result.skipped.length }, 'migrations done');
