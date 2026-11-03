import type { EncryptedSecret } from '../../../crypto/index.js';
import type { IntegrationSecretField } from '../../domain/integration-secret-context.js';
import type { TelegramIntegrationKind } from '../../domain/integration-config.js';

/** Integración tal como la ve la persona que la administra: nunca incluye el secreto. */
export interface IntegrationRecord {
  readonly id: string;
  readonly kind: TelegramIntegrationKind;
  readonly name: string;
  readonly status: 'active' | 'archived';
  /** Dato personal: se muestra solo a quien administra el canal y nunca se registra. */
  readonly chatId: string | null;
  /** Indica que hay un token guardado; el valor jamás se devuelve. */
  readonly hasBotToken: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredIntegrationSecret {
  readonly secretVersion: number;
  readonly encrypted: EncryptedSecret;
}

export interface NewIntegration {
  readonly kind: TelegramIntegrationKind;
  readonly name: string;
  readonly chatId: string;
  readonly createdBy: string;
}

export interface IntegrationRepository {
  /** Bloquea la fila hasta el fin de la transacción: serializa ediciones y rotaciones concurrentes. */
  findForUpdate(integrationId: string): Promise<IntegrationRecord | null>;
  findActiveByKind(kind: TelegramIntegrationKind): Promise<IntegrationRecord | null>;
  /** Las integraciones de esos tipos, activas primero y luego por fecha. */
  listByKinds(kinds: readonly TelegramIntegrationKind[]): Promise<readonly IntegrationRecord[]>;
  insert(integration: NewIntegration): Promise<IntegrationRecord>;
  update(
    integrationId: string,
    changes: { readonly name: string; readonly chatId: string },
  ): Promise<IntegrationRecord>;
  archive(integrationId: string, archivedAt: Date): Promise<IntegrationRecord>;
  findSecret(
    integrationId: string,
    field: IntegrationSecretField,
  ): Promise<StoredIntegrationSecret | null>;
  /** Inserta o reemplaza el secreto del campo; `secretVersion` ya viene incrementada por el llamador. */
  putSecret(secret: {
    readonly integrationId: string;
    readonly field: IntegrationSecretField;
    readonly secretVersion: number;
    readonly encrypted: EncryptedSecret;
    readonly rotatedAt: Date;
  }): Promise<void>;
}
