import { loadConfig } from './app/config.js';
import { createApp } from './app/create-app.js';
import { createLogger } from './shared/infrastructure/logger.js';

const config = loadConfig(process.env);
const logger = createLogger({ level: config.LOG_LEVEL });
const app = await createApp({ logger });

await app.listen(config.PORT, config.HOST);
logger.info({ host: config.HOST, port: config.PORT }, 'http server listening');
