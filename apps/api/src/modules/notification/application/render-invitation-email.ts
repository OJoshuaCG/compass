import type { EmergencyAlertMessage, InvitationMessage } from './ports/mailer.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const COPY = {
  'es-MX': {
    subject: 'Te invitaron a la plataforma',
    intro: 'Te invitaron a unirte a la plataforma interna de identidad y accesos.',
    action: 'Abre este enlace para elegir tu contraseña y registrar tu segundo factor:',
    expires: (date: string) => `El enlace es de un solo uso y vence el ${date}.`,
    ignore: 'Si no esperabas este mensaje, ignóralo: no se creará ninguna cuenta.',
  },
  'en-US': {
    subject: 'You have been invited to the platform',
    intro: 'You have been invited to join the internal identity and access platform.',
    action: 'Open this link to choose your password and register your second factor:',
    expires: (date: string) => `The link is single-use and expires on ${date}.`,
    ignore: 'If you did not expect this message, ignore it: no account will be created.',
  },
} as const;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * Cuerpo del correo de invitación. El token viaja en el fragmento del enlace (`#token=`), que el
 * navegador no envía al servidor ni queda en sus registros de acceso. No incluye datos de quien
 * invita ni de la organización: el destinatario solo necesita el enlace.
 */
export function renderInvitationEmail(message: InvitationMessage, baseUrl: string): RenderedEmail {
  const copy = COPY[message.locale];
  const link = `${baseUrl}/invitation#token=${encodeURIComponent(message.token)}`;
  const expires = copy.expires(
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.expiresAt) + ' UTC',
  );
  return {
    subject: copy.subject,
    text: [copy.intro, '', copy.action, link, '', expires, copy.ignore].join('\n'),
    html: [
      `<p>${escapeHtml(copy.intro)}</p>`,
      `<p>${escapeHtml(copy.action)}</p>`,
      `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
      `<p>${escapeHtml(expires)}</p>`,
      `<p>${escapeHtml(copy.ignore)}</p>`,
    ].join('\n'),
  };
}

const ALERT_COPY = {
  'es-MX': {
    subject: 'Alerta de seguridad: se usó un código de emergencia de la Raíz',
    body: (when: string) =>
      `Se usó un código de emergencia de la persona Raíz el ${when}. Su segundo factor quedó restablecido y debe registrar uno nuevo. Si no esperabas este aviso, revisa de inmediato la auditoría de la organización.`,
  },
  'en-US': {
    subject: 'Security alert: a Root emergency code was used',
    body: (when: string) =>
      `A Root emergency code was used on ${when}. Their second factor was reset and they must register a new one. If you did not expect this notice, review the organization audit trail immediately.`,
  },
} as const;

/** Aviso a los Administradores: dice qué pasó y cuándo, nunca quién ni desde dónde (no hay secretos). */
export function renderEmergencyAlertEmail(message: EmergencyAlertMessage): RenderedEmail {
  const copy = ALERT_COPY[message.locale];
  const when =
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.usedAt) + ' UTC';
  const body = copy.body(when);
  return { subject: copy.subject, text: body, html: `<p>${escapeHtml(body)}</p>` };
}
