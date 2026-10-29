import type { CredentialKind } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';

/** Campos cifrados que guarda esta porción. `totp_uri` es el URI otpauth del segundo factor. */
export type SecretField = 'username' | 'password' | 'totp_uri';

export interface CredentialRecord {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
  readonly kind: CredentialKind;
  readonly lastRotatedAt: Date | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
}

export interface NewCredential {
  readonly id: string;
  readonly accountId: string;
  readonly label: string;
  readonly kind: CredentialKind;
  readonly createdBy: UserId;
}

/** Una versión cifrada tal como se guarda: texto cifrado con su etiqueta, nonce y versión de DEK. */
export interface SecretVersionRecord {
  readonly field: SecretField;
  readonly version: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
  readonly isCurrent: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface NewSecretVersion {
  readonly id: string;
  readonly credentialId: string;
  readonly field: SecretField;
  readonly version: number;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
  /** HMAC en hexadecimal para búsquedas exactas; `null` si el campo no se busca por valor. */
  readonly blindIndexHex: string | null;
  readonly createdBy: UserId;
}

/** Fila del historial: sin ningún campo con contenido, solo cuándo y quién. */
export interface PasswordVersionSummary {
  readonly version: number;
  readonly isCurrent: boolean;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/** Aviso pendiente para la Raíz cuando alguien supera el tope de revelaciones (ADR 0031). */
export interface RevealLimitNotice {
  readonly actorId: UserId;
  readonly limitPerHour: number;
  /** Revelaciones exitosas contadas en la ventana al momento de negar. */
  readonly revealedInWindow: number;
  readonly windowSeconds: number;
  /** Cuándo se superó el tope (hora del reloj de la aplicación, UTC). */
  readonly raisedAt: Date;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface CredentialRepository {
  insertCredential(credential: NewCredential): Promise<CredentialRecord>;
  findById(credentialId: string): Promise<CredentialRecord | null>;
  /** Bloquea la fila hasta el fin de la transacción: dos cambios de contraseña no se pisan. */
  findByIdForUpdate(credentialId: string): Promise<CredentialRecord | null>;
  /** Credenciales no archivadas de la cuenta, por etiqueta. */
  listByAccount(accountId: string): Promise<readonly CredentialRecord[]>;
  /** Versión vigente del campo, o `null` si la credencial no lo tiene. */
  currentSecret(credentialId: string, field: SecretField): Promise<SecretVersionRecord | null>;
  /** Una versión concreta del campo (vigente o histórica), o `null` si no existe en esta credencial. */
  secretByVersion(
    credentialId: string,
    field: SecretField,
    version: number,
  ): Promise<SecretVersionRecord | null>;
  /**
   * Marca como no vigente la versión actual del campo. Debe ir ANTES de insertar la nueva: el índice
   * único parcial solo admite una versión vigente por campo.
   */
  retireCurrentSecret(credentialId: string, field: SecretField): Promise<void>;
  insertSecret(secret: NewSecretVersion): Promise<void>;
  /** Una huella por credencial; se reemplaza en cada cambio de contraseña. */
  upsertPasswordFingerprint(credentialId: string, hmacHex: string): Promise<void>;
  markRotated(credentialId: string, at: Date): Promise<void>;
  passwordHistory(credentialId: string): Promise<readonly PasswordVersionSummary[]>;
  /**
   * Toma el bloqueo de la persona para el límite de revelaciones (ADR 0031). Debe tomarse antes que el
   * bloqueo de auditoría (ADR 0023): el evento de auditoría es siempre lo último que se escribe.
   */
  lockRevealsOf(userId: UserId): Promise<void>;
  /** Deja el aviso a la Raíz en la bandeja de salida, en la misma transacción. */
  enqueueRevealLimitNotice(notice: RevealLimitNotice): Promise<void>;
}
