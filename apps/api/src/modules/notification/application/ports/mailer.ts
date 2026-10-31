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

/**
 * Cambios de seguridad de la propia cuenta que se avisan a la persona (TODO G5). `totp_removed` (baja del
 * factor de aplicación) sale por el outbox; los demás se envían después del _commit_ con mejor esfuerzo.
 */
export type SecurityNoticeKind =
  'recovery_code_used' | 'passkey_added' | 'passkey_removed' | 'totp_removed';

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

/**
 * Aviso a quien registró un segundo factor (TOTP) de que lleva más de 24 horas sin confirmarse. Solo dice
 * que hay un registro pendiente y desde cuándo: NO incluye el nombre de la cuenta ni de la credencial, ni
 * enlaces, ni la clave ni ningún código.
 */
export interface PendingTotpNoticeMessage {
  readonly to: string;
  readonly locale: 'es-MX' | 'en-US';
  /** Nombre visible de la destinataria; `null` si no se puede resolver (el aviso sale igual, sin saludo con nombre). */
  readonly recipientDisplayName: string | null;
  /** Momento en que se registró el segundo factor (UTC). */
  readonly registeredAt: Date;
}

/**
 * Aviso a la persona de que su rango cambió (sube o baja). Dice quién lo hizo, de qué rango a cuál y cuándo;
 * NO incluye el motivo (va a la auditoría), la lista de roles retirados ni enlaces.
 */
export interface RankChangeNoticeMessage {
  readonly to: string;
  /** Idioma de la persona afectada. */
  readonly locale: 'es-MX' | 'en-US';
  /** Nombre visible de quien hizo el cambio; `null` si ya no se puede resolver (el aviso sale igual, sin nombre). */
  readonly changedByDisplayName: string | null;
  readonly fromRank: 0 | 1 | 2 | 3;
  readonly toRank: 0 | 1 | 2 | 3;
  readonly changedAt: Date;
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
  /** Avisa a quien registró un segundo factor de que sigue sin confirmarse pasadas 24 horas (sin secretos ni nombres). */
  sendPendingTotpNotice(message: PendingTotpNoticeMessage): Promise<void>;
  /** Avisa a la persona de que su rango cambió, con el nombre de quien lo hizo (sin motivo, roles ni enlaces). */
  sendRankChangeNotice(message: RankChangeNoticeMessage): Promise<void>;
}
