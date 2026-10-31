import type { RankChangeNoticeMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = RankChangeNoticeMessage['locale'];

/** Nombre que se muestra cuando quien hizo el cambio ya no se puede resolver en el directorio. */
const UNKNOWN_PERSON: Record<Locale, string> = {
  'es-MX': 'una persona de la organización',
  'en-US': 'a person in the organization',
};

/** Nombres de los rangos del plan (0 a 3); el correo los nombra, no los numera. */
const RANK_NAMES: Record<Locale, Record<number, string>> = {
  'es-MX': { 0: 'Raíz', 1: 'Administrador', 2: 'Líder', 3: 'Operador' },
  'en-US': { 0: 'Root', 1: 'Administrator', 2: 'Lead', 3: 'Operator' },
};

const COPY = {
  'es-MX': {
    subject: 'Cambió tu rango en la plataforma',
    what: (person: string, from: string, to: string) =>
      `${person} cambió tu rango de ${from} a ${to}.`,
    when: (date: string) => `Ocurrió el ${date}.`,
    action:
      'Tus sesiones abiertas se cerraron: vuelve a iniciar sesión. Si no esperabas este cambio, avisa a un Administrador.',
  },
  'en-US': {
    subject: 'Your rank on the platform changed',
    what: (person: string, from: string, to: string) =>
      `${person} changed your rank from ${from} to ${to}.`,
    when: (date: string) => `It happened on ${date}.`,
    action:
      'Your open sessions were closed: sign in again. If you did not expect this change, tell an Administrator.',
  },
} as const;

/**
 * Aviso a la persona de que su rango cambió (sube o baja). Lleva el nombre de quien lo hizo (dato del
 * directorio que se sanea y se escapa en el HTML), el rango anterior y el nuevo y la hora en UTC. NO incluye
 * el motivo, la lista de roles retirados ni enlaces (un correo de seguridad con enlaces se imita fácilmente).
 */
export function renderRankChangeEmail(message: RankChangeNoticeMessage): RenderedEmail {
  const copy = COPY[message.locale];
  const rankNames = RANK_NAMES[message.locale];
  // Si tras sanear no queda nada visible se usa el texto genérico, igual que cuando no hay nombre.
  const sanitizedName =
    message.changedByDisplayName === null ? '' : sanitizeDisplayName(message.changedByDisplayName);
  const person = sanitizedName === '' ? UNKNOWN_PERSON[message.locale] : sanitizedName;
  const fromName = rankNames[message.fromRank] ?? String(message.fromRank);
  const toName = rankNames[message.toRank] ?? String(message.toRank);
  const lines: string[] = [
    copy.what(person, fromName, toName),
    copy.when(
      new Intl.DateTimeFormat(message.locale, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(message.changedAt) + ' UTC',
    ),
  ];
  return {
    subject: copy.subject,
    text: [...lines, '', copy.action].join('\n'),
    html: [...lines, copy.action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
