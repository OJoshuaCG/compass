import type { PendingTotpNoticeMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = PendingTotpNoticeMessage['locale'];

const COPY = {
  'es-MX': {
    subject: 'Tu segundo factor sigue sin confirmarse',
    greeting: (name: string) => `Hola, ${name}.`,
    greetingAnonymous: 'Hola.',
    what: (date: string) =>
      `Registraste un segundo factor en la bóveda el ${date} y lleva más de 24 horas sin confirmarse.`,
    risk: 'Mientras no se confirme, no se sabe si el código que genera la plataforma coincide con el registrado y la cuenta podría quedar bloqueada.',
    action:
      'Entra a la plataforma y confirma el código, o retira el segundo factor si ya no lo necesitas. Por seguridad, este correo no incluye nombres de cuentas ni de credenciales, ni enlaces.',
  },
  'en-US': {
    subject: 'Your second factor is still unconfirmed',
    greeting: (name: string) => `Hello, ${name}.`,
    greetingAnonymous: 'Hello.',
    what: (date: string) =>
      `You registered a second factor in the vault on ${date} and it has been unconfirmed for more than 24 hours.`,
    risk: 'Until it is confirmed there is no proof that the code the platform generates matches the registered one, and the account could end up locked.',
    action:
      'Sign in to the platform and confirm the code, or retire the second factor if you no longer need it. For safety, this email does not include account or credential names, or links.',
  },
} as const satisfies Record<
  Locale,
  {
    subject: string;
    greeting: (name: string) => string;
    greetingAnonymous: string;
    what: (date: string) => string;
    risk: string;
    action: string;
  }
>;

/**
 * Aviso de un segundo factor pendiente de confirmar. Solo lleva el nombre de la destinataria (dato del
 * directorio: se sanea y se escapa en el HTML) y la hora del registro en UTC. No incluye enlaces (un correo
 * de seguridad con enlaces se imita fácilmente) ni nada de la cuenta o la credencial.
 */
export function renderPendingTotpEmail(message: PendingTotpNoticeMessage): RenderedEmail {
  const copy = COPY[message.locale];
  // Si tras sanear no queda nada visible se usa el saludo genérico, igual que cuando no hay nombre.
  const sanitizedName =
    message.recipientDisplayName === null ? '' : sanitizeDisplayName(message.recipientDisplayName);
  const greeting = sanitizedName === '' ? copy.greetingAnonymous : copy.greeting(sanitizedName);
  const registeredAt =
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.registeredAt) + ' UTC';
  const lines: string[] = [greeting, copy.what(registeredAt), copy.risk];
  return {
    subject: copy.subject,
    text: [...lines, '', copy.action].join('\n'),
    html: [...lines, copy.action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
