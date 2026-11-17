import { createTransport } from 'nodemailer';

import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from '../../notification/index.js';
import type { MailTransport } from '../../notification/index.js';
import type { SmtpConnectionFields } from '../application/ports/smtp-settings-store.js';
import type { HostResolver } from './guarded-https-client.js';

export type GuardedSmtpTransportResult =
  | { readonly ok: true; readonly transport: MailTransport }
  | { readonly ok: false; readonly code: 'HOST_UNRESOLVED' | 'HOST_NOT_ALLOWED' };

/**
 * Abre un transporte SMTP hacia un servidor que escribió una persona de la organización. Mismo riesgo que
 * el sondeo IMAP: el envío corre dentro de la red, así que sin guardia podría alcanzar servicios
 * internos o los metadatos de la nube.
 *
 * Invariantes de seguridad
 * - El nombre se resuelve y valida en CADA envío (rebinding de DNS) y se conecta a la IP ya validada; el
 *   nombre original se conserva solo para verificar el certificado (`servername`).
 * - Solo canales cifrados: `starttls` exige subir a TLS y `tls` abre TLS desde el inicio. Nunca hay modo
 *   sin cifrado, y el certificado se verifica siempre (TLS 1.2 como mínimo).
 * - Los tiempos son los del correo de las variables de entorno: su suma queda por debajo del plazo del
 *   manejador del outbox (ver `outbox-timeouts.test.ts`).
 */
export async function openGuardedSmtpTransport(
  guard: HostResolver,
  connection: SmtpConnectionFields,
  password: string,
): Promise<GuardedSmtpTransportResult> {
  const resolved = await guard.resolve(connection.host);
  if (!resolved.ok) return { ok: false, code: resolved.code };
  const transport = createTransport({
    host: resolved.address,
    port: connection.port,
    secure: connection.security === 'tls',
    requireTLS: connection.security === 'starttls',
    tls: { servername: connection.host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: { user: connection.username, pass: password },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
  return { ok: true, transport };
}
