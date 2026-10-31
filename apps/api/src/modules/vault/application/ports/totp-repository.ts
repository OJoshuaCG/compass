import type { TotpAlgorithm, TotpStatus } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';
import type { TotpDigits, TotpPeriodSeconds } from '../../domain/otpauth-uri.js';

/** Estado del segundo factor vigente de una credencial. El secreto vive cifrado en `credential_secrets`. */
export interface TotpRecord {
  readonly credentialId: string;
  /** Versión del campo `totp_uri` que describe esta fila. */
  readonly secretVersion: number;
  readonly status: TotpStatus;
  readonly algorithm: TotpAlgorithm;
  readonly digits: TotpDigits;
  readonly periodSeconds: TotpPeriodSeconds;
  readonly registeredBy: string;
  readonly registeredAt: Date;
  readonly verifiedAt: Date | null;
  readonly retiredAt: Date | null;
  readonly exposedAt: Date | null;
}

export interface NewTotp {
  readonly credentialId: string;
  readonly secretVersion: number;
  readonly algorithm: TotpAlgorithm;
  readonly digits: TotpDigits;
  readonly periodSeconds: TotpPeriodSeconds;
  readonly registeredBy: UserId;
  readonly registeredAt: Date;
}

export interface NewTotpExportRotationTask {
  readonly credentialId: string;
  readonly triggeredByUser: UserId;
  readonly assignedTo: UserId;
  readonly dueAt: Date;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface TotpRepository {
  find(credentialId: string): Promise<TotpRecord | null>;
  insert(totp: NewTotp): Promise<void>;
  /** Re-registro: la fila vuelve a `pending` con la versión nueva y pierde confirmación y exposición. */
  replace(totp: NewTotp, keepExposure: boolean): Promise<void>;
  markVerified(credentialId: string, at: Date): Promise<void>;
  markRetired(credentialId: string, at: Date): Promise<void>;
  /** Anota que el secreto se exportó y deja "secreto expuesto" en la salud de la credencial. */
  markExposed(credentialId: string, at: Date): Promise<void>;
  /** Una credencial con segundo factor deja de ser solo de contraseña. */
  markCredentialWithTotp(credentialId: string): Promise<void>;
  /**
   * Bloqueo de la pareja persona + credencial para el límite de códigos. Se toma ANTES que el de
   * auditoría (ADR 0023): el evento de auditoría es siempre lo último que se escribe.
   */
  lockCodesOf(userId: UserId, credentialId: string): Promise<void>;
  openExportRotationTaskExists(credentialId: string): Promise<boolean>;
  insertExportRotationTask(task: NewTotpExportRotationTask): Promise<void>;
}
