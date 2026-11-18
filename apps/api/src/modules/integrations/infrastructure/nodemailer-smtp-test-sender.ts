import type {
  SmtpTestSendResult,
  SmtpTestSender,
} from '../application/ports/smtp-settings-store.js';
import { openGuardedSmtpTransport } from './guarded-smtp-transport.js';
import type { HostResolver } from './guarded-https-client.js';

const TEST_SUBJECT = '[Compass] Correo de prueba / Test email';
const TEST_TEXT =
  'Este es un correo de prueba de Compass. Si lo recibes, el servidor SMTP está bien configurado.\n\n' +
  'This is a Compass test email. If you received it, the SMTP server is configured correctly.';

type FailureCode = Extract<SmtpTestSendResult, { ok: false }>['code'];

interface NodemailerErrorShape {
  readonly code?: unknown;
  readonly responseCode?: unknown;
  readonly message?: unknown;
}

const TLS_CODE_PREFIXES: readonly string[] = [
  'ERR_TLS',
  'CERT_',
  'UNABLE_TO_',
  'DEPTH_ZERO',
  'SELF_SIGNED',
];
const SMTP_MAILBOX_REJECTED_CODES: readonly number[] = [550, 551, 553, 554];

/**
 * Traduce el error del transporte a un código estable. El texto original NUNCA sale de aquí: puede citar
 * el servidor, el usuario o la dirección.
 */
function classify(error: unknown): FailureCode {
  const shape = (typeof error === 'object' && error !== null ? error : {}) as NodemailerErrorShape;
  const code = typeof shape.code === 'string' ? shape.code : '';
  const message = typeof shape.message === 'string' ? shape.message.toLowerCase() : '';
  if (code === 'EAUTH') return 'AUTH_REJECTED';
  if (code === 'EENVELOPE') return 'SENDER_REJECTED';
  if (
    typeof shape.responseCode === 'number' &&
    SMTP_MAILBOX_REJECTED_CODES.includes(shape.responseCode)
  ) {
    return 'SENDER_REJECTED';
  }
  if (
    TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
    message.includes('certificate')
  ) {
    return 'TLS_FAILED';
  }
  if (code === 'ETIMEDOUT' || message.includes('timeout')) return 'TIMEOUT';
  if (code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED') {
    return 'CONNECTION_FAILED';
  }
  return 'SEND_FAILED';
}

/** Envía el correo de prueba por el servidor configurado, pasando por el guardia de red. */
export class NodemailerSmtpTestSender implements SmtpTestSender {
  constructor(private readonly guard: HostResolver) {}

  async send(input: Parameters<SmtpTestSender['send']>[0]): Promise<SmtpTestSendResult> {
    const opened = await openGuardedSmtpTransport(this.guard, input.connection, input.password);
    if (!opened.ok) return { ok: false, code: opened.code };
    try {
      await opened.transport.sendMail({
        from: input.connection.fromAddress,
        to: input.recipient,
        subject: TEST_SUBJECT,
        text: TEST_TEXT,
        html: `<p>${TEST_TEXT.replace(/\n\n/g, '</p><p>')}</p>`,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, code: classify(error) };
    }
  }
}
