import type { RootTransferNoticeMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = RootTransferNoticeMessage['locale'];
type Role = RootTransferNoticeMessage['recipientRole'];

/** Nombre que se muestra cuando una de las personas ya no se puede resolver en el directorio. */
const UNKNOWN_PERSON: Record<Locale, string> = {
  'es-MX': 'una persona de la organización',
  'en-US': 'a person in the organization',
};

interface Copy {
  readonly subject: string;
  readonly what: string;
  readonly action: string;
}

interface Names {
  readonly from: string;
  readonly to: string;
}

const formatUtc = (date: Date, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date) + ' UTC';

/**
 * Advertencia del cierre: los códigos de emergencia anteriores quedaron anulados y no hay recuperación de
 * emergencia hasta que Operaciones emita nuevos con las dos custodias (decisión del dueño, L22).
 */
const EMERGENCY_WARNING: Record<Locale, string> = {
  'es-MX':
    'Los códigos de emergencia anteriores quedaron anulados. Mientras Operaciones no emita nuevos con las dos custodias, la organización no tiene recuperación de emergencia.',
  'en-US':
    'The previous emergency codes were voided. Until Operations issues new ones with the two custodians, the organization has no emergency recovery.',
};

function spanish(message: RootTransferNoticeMessage, names: Names, executesAt: string): Copy {
  const role: Role = message.recipientRole;
  switch (message.kind) {
    case 'requested':
      if (role === 'previous_root') {
        return {
          subject: 'Propusiste transferir la Raíz',
          what: `Propusiste transferir el puesto de Raíz a ${names.to}.`,
          action:
            'Si no la acepta en 7 días, la propuesta caduca. Puedes cancelarla cuando quieras.',
        };
      }
      if (role === 'new_root') {
        return {
          subject: 'Te proponen recibir la Raíz',
          what: `${names.from} te propone transferirte el puesto de Raíz.`,
          action:
            'Para aceptar, inicia sesión y confirma con tu contraseña. Si no la aceptas en 7 días, la propuesta caduca.',
        };
      }
      return {
        subject: 'Propuesta de transferencia de la Raíz',
        what: `${names.from} propuso transferir el puesto de Raíz a ${names.to}.`,
        action: 'Cualquier Administrador puede cancelarla si no la reconoce.',
      };
    case 'accepted':
      return {
        subject: 'Transferencia de la Raíz aceptada',
        what:
          role === 'new_root'
            ? `Aceptaste recibir el puesto de Raíz de ${names.from}.`
            : `${names.to} aceptó recibir el puesto de Raíz de ${names.from}.`,
        action: `La transferencia se completará el ${executesAt}. Hasta entonces la Raíz actual, la persona que recibe o cualquier Administrador pueden cancelarla.`,
      };
    case 'cancelled':
      return {
        subject: 'Transferencia de la Raíz cancelada',
        what: message.automatic
          ? `La transferencia del puesto de Raíz de ${names.from} a ${names.to} se canceló sola porque quien la recibía dejó de ser Administrador activo.`
          : `Se canceló la transferencia del puesto de Raíz de ${names.from} a ${names.to}.`,
        action: 'No cambió ningún rango ni ningún acceso.',
      };
    case 'expired':
      return {
        subject: 'Propuesta de transferencia caducada',
        what: `La propuesta de transferir el puesto de Raíz de ${names.from} a ${names.to} caducó sin aceptarse.`,
        action: 'No cambió ningún rango ni ningún acceso.',
      };
    case 'completed':
      if (role === 'previous_root') {
        return {
          subject: 'Dejaste de ser la Raíz',
          what: `La transferencia terminó: ${names.to} es ahora la Raíz y tú sigues como Administrador.`,
          action:
            'Se cerraron tus sesiones y tus factores: inicia sesión y regístralos de nuevo. ' +
            EMERGENCY_WARNING['es-MX'],
        };
      }
      if (role === 'new_root') {
        return {
          subject: 'Ahora eres la Raíz',
          what: `La transferencia terminó: ahora eres la Raíz de la organización.`,
          action: EMERGENCY_WARNING['es-MX'],
        };
      }
      return {
        subject: 'Cambió la Raíz de la organización',
        what: `La transferencia terminó: ${names.to} es ahora la Raíz y ${names.from} sigue como Administrador.`,
        action: EMERGENCY_WARNING['es-MX'],
      };
  }
}

function english(message: RootTransferNoticeMessage, names: Names, executesAt: string): Copy {
  const role: Role = message.recipientRole;
  switch (message.kind) {
    case 'requested':
      if (role === 'previous_root') {
        return {
          subject: 'You proposed a Root transfer',
          what: `You proposed transferring the Root role to ${names.to}.`,
          action:
            'If it is not accepted within 7 days the proposal expires. You can cancel it at any time.',
        };
      }
      if (role === 'new_root') {
        return {
          subject: 'You were offered the Root role',
          what: `${names.from} proposes to transfer the Root role to you.`,
          action:
            'To accept, sign in and confirm with your password. If you do not accept within 7 days the proposal expires.',
        };
      }
      return {
        subject: 'Root transfer proposed',
        what: `${names.from} proposed transferring the Root role to ${names.to}.`,
        action: 'Any Administrator can cancel it if they do not recognize it.',
      };
    case 'accepted':
      return {
        subject: 'Root transfer accepted',
        what:
          role === 'new_root'
            ? `You accepted the Root role from ${names.from}.`
            : `${names.to} accepted the Root role from ${names.from}.`,
        action: `The transfer will complete on ${executesAt}. Until then the current Root, the recipient or any Administrator can cancel it.`,
      };
    case 'cancelled':
      return {
        subject: 'Root transfer cancelled',
        what: message.automatic
          ? `The Root transfer from ${names.from} to ${names.to} was cancelled automatically because the recipient stopped being an active Administrator.`
          : `The Root transfer from ${names.from} to ${names.to} was cancelled.`,
        action: 'No rank or access changed.',
      };
    case 'expired':
      return {
        subject: 'Root transfer proposal expired',
        what: `The proposal to transfer the Root role from ${names.from} to ${names.to} expired without being accepted.`,
        action: 'No rank or access changed.',
      };
    case 'completed':
      if (role === 'previous_root') {
        return {
          subject: 'You are no longer the Root',
          what: `The transfer is complete: ${names.to} is now the Root and you remain an Administrator.`,
          action:
            'Your sessions and factors were closed: sign in and register them again. ' +
            EMERGENCY_WARNING['en-US'],
        };
      }
      if (role === 'new_root') {
        return {
          subject: 'You are now the Root',
          what: 'The transfer is complete: you are now the Root of the organization.',
          action: EMERGENCY_WARNING['en-US'],
        };
      }
      return {
        subject: 'The organization Root changed',
        what: `The transfer is complete: ${names.to} is now the Root and ${names.from} remains an Administrator.`,
        action: EMERGENCY_WARNING['en-US'],
      };
  }
}

const displayNameOf = (name: string | null, locale: Locale): string => {
  const sanitized = name === null ? '' : sanitizeDisplayName(name);
  return sanitized === '' ? UNKNOWN_PERSON[locale] : sanitized;
};

/**
 * Aviso de una transferencia de la Raíz. Lleva los nombres visibles de las dos personas (datos del directorio
 * que se sanean y se escapan en el HTML) y fechas en UTC. NO incluye enlaces, códigos ni correos: un correo
 * de seguridad con enlaces se imita fácilmente y el detalle vive en la auditoría.
 */
export function renderRootTransferEmail(message: RootTransferNoticeMessage): RenderedEmail {
  const names: Names = {
    from: displayNameOf(message.fromDisplayName, message.locale),
    to: displayNameOf(message.toDisplayName, message.locale),
  };
  const executesAt =
    message.executesAt === null ? '' : formatUtc(message.executesAt, message.locale);
  const copy =
    message.locale === 'es-MX'
      ? spanish(message, names, executesAt)
      : english(message, names, executesAt);
  const when =
    message.locale === 'es-MX'
      ? `Momento: ${formatUtc(message.occurredAt, message.locale)}.`
      : `Time: ${formatUtc(message.occurredAt, message.locale)}.`;
  const lines = [copy.what, when, copy.action];
  return {
    subject: copy.subject,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
