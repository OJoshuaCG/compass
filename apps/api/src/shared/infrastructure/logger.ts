import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';

const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'totp',
  'code',
  'authorization',
  'cookie',
  'ciphertext',
  'wrapped_dek',
] as const;

/**
 * Redacción por configuración (plan: "Logs"): cada clave sensible a profundidad 0, 1 y 2, las
 * cabeceras de petición/respuesta con credenciales y todo el cuerpo de la petición. Los cuerpos
 * de las rutas de revelación, códigos y handoff nunca se registran.
 */
export const REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  ...SENSITIVE_KEYS.map((key) => `*.*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body',
];

export interface LoggerOptions {
  readonly level: string;
  readonly destination?: DestinationStream;
}

export function createLogger({ level, destination }: LoggerOptions): Logger {
  return pino({ level, redact: { paths: [...REDACT_PATHS], censor: '[Redacted]' } }, destination);
}
