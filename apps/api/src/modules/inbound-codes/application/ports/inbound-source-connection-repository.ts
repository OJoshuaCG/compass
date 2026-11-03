import type { EncryptedSecret } from '../../../crypto/index.js';
import type { UserId } from '../../../../shared/kernel/index.js';
import type { MailTlsMode } from './mail-connection-loader.js';

/** Conexión IMAP de una fuente tal como se guarda, sin la contraseña en claro (nunca sale de la base cifrada). */
export interface SourceConnectionRecord {
  readonly sourceId: string;
  readonly host: string;
  readonly port: number;
  readonly tlsMode: MailTlsMode;
  readonly username: string;
  readonly authservId: string;
  readonly acceptedRecipients: readonly string[];
  readonly hasPassword: boolean;
  readonly secretVersion: number;
  readonly updatedAt: Date;
}

/**
 * Qué hacer con la contraseña al guardar:
 * - `keep`: se deja la guardada (y su `secret_version`) tal cual.
 * - `clear`: se borra; la fuente deja de sondearse hasta que alguien la reintroduzca.
 * - `set`: se guarda la nueva, ya cifrada con el contexto de `secretVersion`.
 */
export type PasswordChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly encrypted: EncryptedSecret };

export interface SourceConnectionWrite {
  readonly sourceId: string;
  readonly host: string;
  readonly port: number;
  readonly tlsMode: MailTlsMode;
  readonly username: string;
  readonly authservId: string;
  readonly acceptedRecipients: readonly string[];
  readonly password: PasswordChange;
  readonly secretVersion: number;
  readonly createdBy: UserId;
}

/** Todo corre en la transacción en curso, con la organización fijada por RLS. */
export interface InboundSourceConnectionRepository {
  find(sourceId: string): Promise<SourceConnectionRecord | null>;
  /** Bloquea la fila de la conexión (si existe) para serializar cambios concurrentes. */
  findForUpdate(sourceId: string): Promise<SourceConnectionRecord | null>;
  /** Cuántas de las direcciones son el correo de alguna persona de la organización. */
  countUserEmails(addresses: readonly string[]): Promise<number>;
  insert(connection: SourceConnectionWrite): Promise<SourceConnectionRecord>;
  update(connection: SourceConnectionWrite): Promise<SourceConnectionRecord>;
}
