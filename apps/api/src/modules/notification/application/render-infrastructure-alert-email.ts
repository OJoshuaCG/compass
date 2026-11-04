import type { InfrastructureAlertMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml } from './sanitize-display-name.js';

type Locale = InfrastructureAlertMessage['locale'];
type AlertCode = InfrastructureAlertMessage['code'];

const COPY: Readonly<
  Record<
    Locale,
    {
      subject: string;
      what: Record<AlertCode, string>;
      when: (date: string) => string;
      action: string;
    }
  >
> = {
  'es-MX': {
    subject: 'Alerta de infraestructura de Compass',
    what: {
      service_unhealthy: 'Un servicio de la plataforma no está respondiendo con normalidad.',
      job_failed: 'Una tarea programada de la plataforma falló y requiere atención.',
      events_quarantined: 'Hay eventos internos en cuarentena que requieren revisión.',
    },
    when: (date) => `Ocurrió el ${date}.`,
    action:
      'Revisa los registros del servidor o avisa a quien opera la plataforma. Por seguridad, este correo no incluye detalles técnicos.',
  },
  'en-US': {
    subject: 'Compass infrastructure alert',
    what: {
      service_unhealthy: 'A platform service is not responding normally.',
      job_failed: 'A scheduled platform job failed and needs attention.',
      events_quarantined: 'Some internal events are quarantined and need review.',
    },
    when: (date) => `It happened on ${date}.`,
    action:
      'Check the server logs or tell whoever operates the platform. For safety, this email does not include technical details.',
  },
};

/**
 * Alerta de infraestructura a la Raíz. Solo texto fijo por código y la hora en UTC: sin enlaces (un correo
 * de alerta con enlaces se imita fácilmente) ni nada que venga del evento.
 */
export function renderInfrastructureAlertEmail(message: InfrastructureAlertMessage): RenderedEmail {
  const copy = COPY[message.locale];
  const formattedDate =
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.occurredAt) + ' UTC';
  const lines: string[] = [copy.what[message.code], copy.when(formattedDate)];
  return {
    subject: copy.subject,
    text: [...lines, '', copy.action].join('\n'),
    html: [...lines, copy.action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
