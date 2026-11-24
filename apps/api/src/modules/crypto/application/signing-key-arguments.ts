import { SigningKeyCommandError } from './signing-key-command-error.js';
import type { SigningAlgorithm } from './ports/signing-keys.js';

export type SigningKeyCommand =
  | { readonly action: 'list' }
  | { readonly action: 'rotate'; readonly algorithm: SigningAlgorithm | undefined }
  | { readonly action: 'retire'; readonly kid: string };

export const SIGNING_KEY_USAGE = 'Uso: signing-keys list | rotate [ES256|RS256] | retire <kid>';

const SUPPORTED_ALGORITHMS: readonly SigningAlgorithm[] = ['ES256', 'RS256'];
/** El `kid` es base64url (16 bytes aleatorios = 22 caracteres); se deja margen para claves migradas. */
const KID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const usageError = (reason: string): SigningKeyCommandError =>
  new SigningKeyCommandError('USAGE', `${reason}. ${SIGNING_KEY_USAGE}`);

/** Valida los argumentos de la consola antes de tocar la base de datos o el KMS. */
export function parseSigningKeyArguments(args: readonly string[]): SigningKeyCommand {
  const [action, first, ...rest] = args;

  if (action === 'list') {
    if (first !== undefined) throw usageError('list no recibe argumentos');
    return { action: 'list' };
  }

  if (action === 'rotate') {
    if (rest.length > 0) throw usageError('rotate recibe como máximo un algoritmo');
    if (first === undefined) return { action: 'rotate', algorithm: undefined };
    const algorithm = SUPPORTED_ALGORITHMS.find((supported) => supported === first);
    if (algorithm === undefined) throw usageError('Algoritmo no admitido');
    return { action: 'rotate', algorithm };
  }

  if (action === 'retire') {
    if (first === undefined) throw usageError('retire exige un kid');
    if (rest.length > 0) throw usageError('retire recibe un solo kid');
    if (!KID_PATTERN.test(first)) throw usageError('El kid no tiene un formato válido');
    return { action: 'retire', kid: first };
  }

  throw usageError('Acción desconocida');
}
