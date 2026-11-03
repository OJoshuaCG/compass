/** Fachada pública del módulo `integrations` (ADR 0047): censura de identificadores, secretos y recifrado. */
export { maskIdentifier } from './domain/mask-identifier.js';
export {
  INTEGRATION_SECRET_FIELDS,
  integrationSecretContext,
} from './domain/integration-secret-context.js';
export type { IntegrationSecretField } from './domain/integration-secret-context.js';
export { ReencryptIntegrationSecrets } from './application/reencrypt-integration-secrets.js';
export type {
  IntegrationSecretStore,
  StaleIntegrationSecret,
} from './application/ports/integration-secret-store.js';
export { PgIntegrationSecretStore } from './infrastructure/pg-integration-secret-store.js';
export {
  INFRASTRUCTURE_ALERT_AGGREGATE,
  INFRASTRUCTURE_ALERT_CODES,
  INFRASTRUCTURE_ALERT_EVENT_TYPE,
  serializeInfrastructureAlert,
} from './domain/infrastructure-alert.js';
export type {
  InfrastructureAlertCode,
  InfrastructureAlertPayload,
} from './domain/infrastructure-alert.js';
export { NotifyInfrastructureAlert } from './application/notify-infrastructure-alert.js';
export type {
  ActiveTelegramChannel,
  TelegramChannelKind,
  TelegramChannelStore,
} from './application/ports/telegram-channel-store.js';
export { GuardedHttpsClient } from './infrastructure/guarded-https-client.js';
export { createNodeHttpsTransport } from './infrastructure/node-https-transport.js';
export { PgTelegramChannelStore } from './infrastructure/pg-telegram-channel-store.js';
export { TelegramBotSender } from './infrastructure/telegram-bot-sender.js';
export { ManageTelegramIntegrations } from './application/manage-telegram-integrations.js';
export type { TestSendOutcome } from './application/manage-telegram-integrations.js';
export type { IntegrationRecord } from './application/ports/integration-repository.js';
export { PgIntegrationRepository } from './infrastructure/pg-integration-repository.js';
