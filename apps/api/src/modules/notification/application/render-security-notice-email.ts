import type { SecurityNoticeKind, SecurityNoticeMessage } from './ports/mailer.js';
import type { RenderedEmail } from './render-invitation-email.js';

type NoticeCopy = { readonly subject: string; readonly what: string };

const COPY: Record<SecurityNoticeMessage['locale'], Record<SecurityNoticeKind, NoticeCopy>> = {
  'es-MX': {
    recovery_code_used: {
      subject: 'Se usó un código de recuperación en tu cuenta',
      what: 'Se usó uno de tus códigos de recuperación para completar un inicio de sesión.',
    },
    passkey_added: {
      subject: 'Se agregó una llave de acceso a tu cuenta',
      what: 'Se registró una llave de acceso nueva en tu cuenta.',
    },
    passkey_removed: {
      subject: 'Se quitó una llave de acceso de tu cuenta',
      what: 'Se quitó una de las llaves de acceso de tu cuenta.',
    },
  },
  'en-US': {
    recovery_code_used: {
      subject: 'A recovery code was used on your account',
      what: 'One of your recovery codes was used to complete a sign-in.',
    },
    passkey_added: {
      subject: 'A passkey was added to your account',
      what: 'A new passkey was registered on your account.',
    },
    passkey_removed: {
      subject: 'A passkey was removed from your account',
      what: 'One of the passkeys on your account was removed.',
    },
  },
};

const ACTION_COPY = {
  'es-MX': {
    when: (date: string) => `Ocurrió el ${date}.`,
    action:
      'Si fuiste tú, no tienes que hacer nada. Si no lo reconoces, cambia tu contraseña y avisa de inmediato a un Administrador.',
  },
  'en-US': {
    when: (date: string) => `It happened on ${date}.`,
    action:
      'If it was you, you do not need to do anything. If you do not recognize it, change your password and tell an Administrator right away.',
  },
} as const;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

/**
 * Aviso a la persona de un cambio en sus factores. Dice qué pasó y cuándo; no incluye dispositivo,
 * dirección de red ni enlaces (un correo de seguridad con enlaces se imita fácilmente).
 */
export function renderSecurityNoticeEmail(message: SecurityNoticeMessage): RenderedEmail {
  const copy = COPY[message.locale][message.kind];
  const actionCopy = ACTION_COPY[message.locale];
  const when = actionCopy.when(
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.occurredAt) + ' UTC',
  );
  return {
    subject: copy.subject,
    text: [copy.what, when, '', actionCopy.action].join('\n'),
    html: [copy.what, when, actionCopy.action]
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('\n'),
  };
}
