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

/** Correo saliente detrás de un puerto (SES en producción; el proveedor es intercambiable). */
export interface Mailer {
  sendInvitation(message: InvitationMessage): Promise<void>;
  /** Avisa a un Administrador de que se usó un código de emergencia de la Raíz (sin datos sensibles). */
  sendEmergencyAlert(message: EmergencyAlertMessage): Promise<void>;
}
