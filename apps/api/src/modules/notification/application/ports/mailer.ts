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

/**
 * Aviso a la Raíz de que una persona superó el tope de revelaciones de contraseñas (ADR 0031).
 * Dice quién, cuántas y cuándo; NO incluye el nombre de la credencial ni de la cuenta, ni el motivo
 * escrito, ni ningún secreto: la Raíz investiga en la auditoría, que sí está protegida por permisos.
 */
export interface RevealLimitAlertMessage {
  readonly to: string;
  readonly locale: 'es-MX' | 'en-US';
  /** Nombre visible de la persona; `null` si ya no se puede resolver (el aviso sale igual, sin nombre). */
  readonly actorDisplayName: string | null;
  readonly limitPerHour: number;
  /** Revelaciones contadas en la ventana; `null` en avisos antiguos que no traían el conteo. */
  readonly revealedInWindow: number | null;
  /** Largo de la ventana móvil en minutos; `null` en avisos antiguos. */
  readonly windowMinutes: number | null;
  readonly occurredAt: Date;
}

/** Correo saliente detrás de un puerto (SES en producción; el proveedor es intercambiable). */
export interface Mailer {
  sendInvitation(message: InvitationMessage): Promise<void>;
  /** Avisa a un Administrador de que se usó un código de emergencia de la Raíz (sin datos sensibles). */
  sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void>;
  /** Avisa a la persona de un cambio de seguridad en su cuenta (código de recuperación, llaves de acceso). */
  sendSecurityNotice(message: SecurityNoticeMessage): Promise<void>;
  /** Avisa a la Raíz de que una persona alcanzó el tope de revelaciones por hora (sin secretos ni credenciales). */
  sendRevealLimitAlert(message: RevealLimitAlertMessage): Promise<void>;
}
