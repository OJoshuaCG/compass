import type { RevealLimitAlertMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = RevealLimitAlertMessage['locale'];

/** Nombre que se muestra cuando la persona ya no se puede resolver en el directorio. */
const UNKNOWN_PERSON: Record<Locale, string> = {
  'es-MX': 'una persona de la organización',
  'en-US': 'a person in the organization',
};

const COPY = {
  'es-MX': {
    subject: 'Alerta: una persona alcanzó el límite de revelaciones de contraseñas',
    what: (person: string, limit: number) =>
      `${person} alcanzó el límite de ${String(limit)} revelaciones de contraseñas por hora y el sistema bloqueó nuevos intentos.`,
    count: (revealed: number, windowMinutes: number) =>
      `Revelaciones en la ventana: ${String(revealed)} (ventana de ${String(windowMinutes)} minutos).`,
    when: (date: string) => `Ocurrió el ${date}.`,
    action:
      'Revisa la auditoría de la organización para confirmar si la actividad es legítima. Si no lo es, suspende la cuenta de la persona y rota las credenciales que reveló. Por seguridad, este correo no incluye nombres de cuentas ni credenciales.',
  },
  'en-US': {
    subject: 'Alert: a person reached the password reveal limit',
    what: (person: string, limit: number) =>
      `${person} reached the limit of ${String(limit)} password reveals per hour and the system blocked further attempts.`,
    count: (revealed: number, windowMinutes: number) =>
      `Reveals in the window: ${String(revealed)} (${String(windowMinutes)}-minute window).`,
    when: (date: string) => `It happened on ${date}.`,
    action:
      'Review the organization audit trail to confirm whether the activity is legitimate. If it is not, suspend the person and rotate the credentials they revealed. For safety, this email does not include account or credential names.',
  },
} as const;

/**
 * Aviso a la Raíz del tope de revelaciones. Solo lleva el nombre de la persona (que es dato del directorio
 * y se escapa en el HTML), los conteos y la hora en UTC; no incluye enlaces (un correo de seguridad con
 * enlaces se imita fácilmente) ni nada de la credencial.
 */
export function renderRevealLimitEmail(message: RevealLimitAlertMessage): RenderedEmail {
  const copy = COPY[message.locale];
  // Si tras sanear no queda nada visible se usa el texto genérico, igual que cuando no hay nombre.
  const sanitizedName =
    message.actorDisplayName === null ? '' : sanitizeDisplayName(message.actorDisplayName);
  const person = sanitizedName === '' ? UNKNOWN_PERSON[message.locale] : sanitizedName;
  const lines: string[] = [copy.what(person, message.limitPerHour)];
  if (message.revealedInWindow !== null && message.windowMinutes !== null) {
    lines.push(copy.count(message.revealedInWindow, message.windowMinutes));
  }
  lines.push(
    copy.when(
      new Intl.DateTimeFormat(message.locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(message.occurredAt) + ' UTC',
    ),
  );
  return {
    subject: copy.subject,
    text: [...lines, '', copy.action].join('\n'),
    html: [...lines, copy.action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
