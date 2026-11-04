import type { OffboardingNoticeMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';
import { escapeHtml, sanitizeDisplayName } from './sanitize-display-name.js';

type Locale = OffboardingNoticeMessage['locale'];

/** Nombre que se muestra cuando quien se fue ya no se puede resolver en el directorio. */
const UNKNOWN_PERSON: Record<Locale, string> = {
  'es-MX': 'una persona de la organización',
  'en-US': 'a person in the organization',
};

const COPY = {
  'es-MX': {
    accounts_assigned: {
      subject: 'Recibiste cuentas por una baja',
      what: (person: string, count: number) =>
        `Por la baja de ${person}, ${String(count)} ${count === 1 ? 'cuenta quedó' : 'cuentas quedaron'} a tu cargo.`,
      action:
        'Ya tienes permiso para gestionarlas. Revisa en la plataforma las tareas de rotación de sus credenciales, que vencen en 72 horas.',
    },
    accounts_unassigned: {
      subject: 'Cuentas sin responsable por una baja',
      what: (person: string, count: number) =>
        `Por la baja de ${person}, ${String(count)} ${count === 1 ? 'cuenta quedó' : 'cuentas quedaron'} sin responsable porque nadie en su cadena podía recibirlas.`,
      action:
        'Asigna un responsable que ya tenga los permisos para compartir, editar y rotar credenciales.',
    },
    report: {
      subject: 'Resumen de la baja',
      what: (person: string) => `Se dio de baja a ${person}.`,
      assigned: (count: number) => `Cuentas reasignadas: ${String(count)}.`,
      unassigned: (count: number) => `Cuentas sin responsable: ${String(count)}.`,
      rotation: (count: number) => `Tareas de rotación creadas: ${String(count)}.`,
      action: 'El detalle de cada cuenta está en la auditoría.',
    },
    when: (date: string) => `Ocurrió el ${date}.`,
  },
  'en-US': {
    accounts_assigned: {
      subject: 'You received accounts because of an offboarding',
      what: (person: string, count: number) =>
        `Because ${person} was offboarded, ${String(count)} ${count === 1 ? 'account is' : 'accounts are'} now yours to manage.`,
      action:
        'You already have the permissions to manage them. Check the platform for the credential rotation tasks, which are due in 72 hours.',
    },
    accounts_unassigned: {
      subject: 'Accounts without an owner after an offboarding',
      what: (person: string, count: number) =>
        `Because ${person} was offboarded, ${String(count)} ${count === 1 ? 'account was' : 'accounts were'} left without an owner: nobody in their chain could take them.`,
      action:
        'Assign an owner who already has the permissions to share, edit and rotate credentials.',
    },
    report: {
      subject: 'Offboarding summary',
      what: (person: string) => `${person} was offboarded.`,
      assigned: (count: number) => `Accounts reassigned: ${String(count)}.`,
      unassigned: (count: number) => `Accounts without an owner: ${String(count)}.`,
      rotation: (count: number) => `Rotation tasks created: ${String(count)}.`,
      action: 'The detail of each account is in the audit log.',
    },
    when: (date: string) => `It happened on ${date}.`,
  },
} as const;

/**
 * Aviso de una baja. Lleva el nombre de quien se fue (dato del directorio que se sanea y se escapa en el
 * HTML), conteos y la hora en UTC. NO incluye nombres de cuentas ni de credenciales ni enlaces: un correo de
 * seguridad con enlaces se imita fácilmente y el detalle vive en la auditoría.
 */
export function renderOffboardingEmail(message: OffboardingNoticeMessage): RenderedEmail {
  const copy = COPY[message.locale];
  const sanitizedName =
    message.leaverDisplayName === null ? '' : sanitizeDisplayName(message.leaverDisplayName);
  const person = sanitizedName === '' ? UNKNOWN_PERSON[message.locale] : sanitizedName;
  const when = copy.when(
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.occurredAt) + ' UTC',
  );

  if (message.kind === 'report') {
    const report = message.report ?? {
      assignedAccountCount: 0,
      unassignedAccountCount: 0,
      rotationTaskCount: 0,
    };
    const lines = [
      copy.report.what(person),
      copy.report.assigned(report.assignedAccountCount),
      copy.report.unassigned(report.unassignedAccountCount),
      copy.report.rotation(report.rotationTaskCount),
      when,
    ];
    return toEmail(copy.report.subject, lines, copy.report.action);
  }

  const kindCopy = copy[message.kind];
  return toEmail(
    kindCopy.subject,
    [kindCopy.what(person, message.accountCount), when],
    kindCopy.action,
  );
}

function toEmail(subject: string, lines: readonly string[], action: string): RenderedEmail {
  return {
    subject,
    text: [...lines, '', action].join('\n'),
    html: [...lines, action].map((line) => `<p>${escapeHtml(line)}</p>`).join('\n'),
  };
}
