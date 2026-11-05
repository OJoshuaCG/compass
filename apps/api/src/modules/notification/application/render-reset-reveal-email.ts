import type { ResetRevealAlertMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = ResetRevealAlertMessage['locale'];

/** Nombre que se muestra cuando la persona ya no se puede resolver en el directorio. */
const UNKNOWN_PERSON: Record<Locale, string> = {
  'es-MX': 'una persona de la organización',
  'en-US': 'a person in the organization',
};

const COPY = {
  'es-MX': {
    subject: 'Alerta: alguien vio códigos o enlaces de restablecimiento',
    what: (person: string, count: number) =>
      count === 1
        ? `${person} vio 1 restablecimiento (código o enlace) recibido por una vista de códigos entrantes.`
        : `${person} vio ${String(count)} restablecimientos (códigos o enlaces) recibidos por una vista de códigos entrantes.`,
    when: (date: string) => `Ocurrió el ${date}.`,
    action:
      'Un restablecimiento permite tomar el control de la cuenta a la que pertenece. Revisa en la auditoría el motivo que dio la persona y, si no lo reconoces, rota la contraseña de esa cuenta. Por seguridad, este correo no incluye el valor, la dirección ni el motivo.',
  },
  'en-US': {
    subject: 'Alert: someone viewed reset codes or links',
    what: (person: string, count: number) =>
      count === 1
        ? `${person} viewed 1 reset (code or link) received by an inbound codes view.`
        : `${person} viewed ${String(count)} resets (codes or links) received by an inbound codes view.`,
    when: (date: string) => `It happened on ${date}.`,
    action:
      'A reset lets someone take over the account it belongs to. Review the reason the person gave in the audit trail and, if you do not recognize it, rotate that account password. For safety, this email does not include the value, the address or the reason.',
  },
} as const;

/**
 * Aviso a la Raíz de una revelación de restablecimientos (ADR 0045). Solo lleva el nombre de la persona
 * (dato del directorio, escapado en el HTML), el conteo y la hora en UTC; sin enlaces (un correo de seguridad
 * con enlaces se imita fácilmente) ni nada del valor revelado.
 */
export function renderResetRevealEmail(message: ResetRevealAlertMessage): RenderedEmail {
  const copy = COPY[message.locale];
  // Si tras sanear no queda nada visible se usa el texto genérico, igual que cuando no hay nombre.
  const sanitizedName =
    message.actorDisplayName === null ? '' : sanitizeDisplayName(message.actorDisplayName);
  const person = sanitizedName === '' ? UNKNOWN_PERSON[message.locale] : sanitizedName;
  const lines: string[] = [
    copy.what(person, message.revealedCount),
    copy.when(
      new Intl.DateTimeFormat(message.locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(message.occurredAt) + ' UTC',
    ),
  ];
  return {
    subject: copy.subject,
    text: [...lines, '', copy.action].join('\n'),
    html: [...lines, copy.action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
