export interface InvitationMessage {
  readonly to: string;
  /** Token en claro: solo viaja en el enlace del correo; en base de datos únicamente vive su hash. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly locale: 'es-MX' | 'en-US';
}

/** Correo saliente detrás de un puerto (SES en producción; el proveedor es intercambiable). */
export interface Mailer {
  sendInvitation(message: InvitationMessage): Promise<void>;
}
