import type { EmergencyAlertMessage, InvitationMessage } from './ports/mailer.js';

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const COPY = {
  'es-MX': {
    subject: 'Te invitaron a Compass',
    intro: 'Te invitaron a unirte a Compass, la plataforma interna de identidad y accesos.',
    action: 'Abre este enlace para elegir tu contraseña y registrar tu segundo factor:',
    expires: (date: string) => `El enlace es de un solo uso y vence el ${date}.`,
    ignore: 'Si no esperabas este mensaje, ignóralo: no se creará ninguna cuenta.',
  },
  'en-US': {
    subject: 'You have been invited to Compass',
    intro: 'You have been invited to join Compass, the internal identity and access platform.',
    action: 'Open this link to choose your password and register your second factor:',
    expires: (date: string) => `The link is single-use and expires on ${date}.`,
    ignore: 'If you did not expect this message, ignore it: no account will be created.',
  },
} as const;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * Enlace de aceptación de una invitación. Lo comparten el correo y la entrega directa a quien invita
 * (`user.invite_link`), para que ambos apunten siempre a la misma pantalla. El token va en el
 * fragmento (`#token=`): el navegador no lo envía al servidor. Se quita la barra final de la base
 * porque el correo recibe `APP_ORIGIN` tal cual y la entrega directa recibe el origen normalizado:
 * sin esto, un `APP_ORIGIN` con barra final daría dos enlaces distintos para el mismo token.
 */
export function buildInvitationLink(baseUrl: string, token: string): string {
  const baseWithoutTrailingSlash = baseUrl.replace(/\/+$/, '');
  return `${baseWithoutTrailingSlash}/invitation#token=${encodeURIComponent(token)}`;
}

/**
 * Cuerpo del correo de invitación. El token viaja en el fragmento del enlace (`#token=`), que el
 * navegador no envía al servidor ni queda en sus registros de acceso. No incluye datos de quien
 * invita ni de la organización: el destinatario solo necesita el enlace.
 */
export function renderInvitationEmail(message: InvitationMessage, baseUrl: string): RenderedEmail {
  const copy = COPY[message.locale];
  const link = buildInvitationLink(baseUrl, message.token);
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
