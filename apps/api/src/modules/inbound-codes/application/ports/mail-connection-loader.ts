import type { SourceRef } from './poll-state-store.js';

export type MailTlsMode = 'tls' | 'starttls';

/** Conexión lista para usar: la contraseña ya está descifrada y vive solo en la memoria del proceso. */
export interface MailConnection {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly tlsMode: MailTlsMode;
  /** `authserv-id` esperado en la primera `Authentication-Results`. */
  readonly authservId: string;
  /** Dirección de la fuente (el buzón que recibe). */
  readonly sourceAddress: string;
  readonly acceptedRecipients: readonly string[];
}

/** Códigos acotados: terminan en `last_error_code` y en la salida del proceso. */
export const MAIL_CONNECTION_LOAD_FAILURES = [
  'CONNECTION_MISSING',
  'PASSWORD_MISSING',
  'PASSWORD_UNREADABLE',
  'KMS_UNAVAILABLE',
] as const;
export type MailConnectionLoadFailure = (typeof MAIL_CONNECTION_LOAD_FAILURES)[number];

export type MailConnectionLoadResult =
  | { readonly ok: true; readonly connection: MailConnection }
  | { readonly ok: false; readonly code: MailConnectionLoadFailure };

/**
 * Carga la conexión de una fuente y descifra su contraseña con el módulo de criptografía. La DEK nunca la
 * crea el worker (ADR 0045, paso 4): si falta, el resultado es `KMS_UNAVAILABLE`.
 */
export interface MailConnectionLoader {
  load(source: SourceRef): Promise<MailConnectionLoadResult>;
}
