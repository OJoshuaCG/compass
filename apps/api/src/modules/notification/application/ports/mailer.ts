export interface InvitationMessage {
  readonly to: string;
  /** Token en claro: solo viaja en el enlace del correo; en base de datos únicamente vive su hash. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly locale: 'es-MX' | 'en-US';
}

export interface EmergencyAlertMessage {
  readonly to: string;
  readonly locale: 'es-MX' | 'en-US';
  readonly usedAt: Date;
}

/** Cambios de seguridad de la propia cuenta que se avisan a la persona (TODO G5). */
export type SecurityNoticeKind = 'recovery_code_used' | 'passkey_added' | 'passkey_removed';

/**
 * Aviso a la persona de un cambio en sus propios factores. Dice qué pasó y cuándo; no incluye
 * dispositivo, dirección de red ni ningún secreto: si no lo hizo ella, solo necesita actuar.
 */
export interface SecurityNoticeMessage {
  readonly to: string;
  readonly locale: 'es-MX' | 'en-US';
  readonly kind: SecurityNoticeKind;
  readonly occurredAt: Date;
}

/** Correo saliente detrás de un puerto (SES en producción; el proveedor es intercambiable). */
export interface Mailer {
  sendInvitation(message: InvitationMessage): Promise<void>;
  /** Avisa a un Administrador de que se usó un código de emergencia de la Raíz (sin datos sensibles). */
  sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void>;
  /** Avisa a la persona de un cambio de seguridad en su cuenta (código de recuperación, llaves de acceso). */
  sendSecurityNotice(message: SecurityNoticeMessage): Promise<void>;
}
