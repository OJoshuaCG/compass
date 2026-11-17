import type { SmtpSecurityValue } from '@iam/contracts';

import type { EncryptedSecret } from '../../../crypto/index.js';

/** Servidor SMTP tal como lo ve quien lo administra: nunca incluye la contraseña. */
export interface SmtpSettingsRecord {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurityValue;
  readonly username: string;
  readonly fromAddress: string;
  /** Indica que hay una contraseña guardada; el valor jamás se devuelve. */
  readonly hasPassword: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SmtpConnectionFields {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurityValue;
  readonly username: string;
  readonly fromAddress: string;
}

export interface NewSmtpSettings extends SmtpConnectionFields {
  readonly name: string;
  readonly createdBy: string;
}

export interface StoredSmtpPassword {
  readonly secretVersion: number;
  readonly encrypted: EncryptedSecret;
}

/**
 * Persistencia del servidor SMTP de la organización fijada en la transacción en curso (integraciones de
 * tipo `smtp_mail`, ADR 0047). El aislamiento por filas limita todo a esa organización.
 */
export interface SmtpSettingsStore {
  /** Bloquea la fila hasta el fin de la transacción: serializa ediciones y rotaciones concurrentes. */
  findForUpdate(settingsId: string): Promise<SmtpSettingsRecord | null>;
  findActive(): Promise<SmtpSettingsRecord | null>;
  /** Activo primero y luego por fecha. */
  list(): Promise<readonly SmtpSettingsRecord[]>;
  insert(settings: NewSmtpSettings): Promise<SmtpSettingsRecord>;
  update(
    settingsId: string,
    changes: SmtpConnectionFields & { readonly name: string },
  ): Promise<SmtpSettingsRecord>;
  archive(settingsId: string, archivedAt: Date): Promise<SmtpSettingsRecord>;
  findPassword(settingsId: string): Promise<StoredSmtpPassword | null>;
  /** Inserta o reemplaza la contraseña; `secretVersion` ya viene incrementada por el llamador. */
  putPassword(secret: {
    readonly settingsId: string;
    readonly secretVersion: number;
    readonly encrypted: EncryptedSecret;
    readonly rotatedAt: Date;
  }): Promise<void>;
}

/** Resultado del envío de prueba: el código es estable y nunca contiene texto del servidor SMTP. */
export type SmtpTestSendResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'HOST_UNRESOLVED'
        | 'HOST_NOT_ALLOWED'
        | 'CONNECTION_FAILED'
        | 'TLS_FAILED'
        | 'AUTH_REJECTED'
        | 'SENDER_REJECTED'
        | 'TIMEOUT'
        | 'SEND_FAILED';
    };

export interface SmtpTestSender {
  /** Envía un correo fijo a `recipient` con la configuración dada. Nunca devuelve texto del servidor. */
  send(input: {
    readonly connection: SmtpConnectionFields;
    readonly password: string;
    readonly recipient: string;
  }): Promise<SmtpTestSendResult>;
}
