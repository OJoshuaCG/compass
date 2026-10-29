import { describe, expect, it } from 'vitest';

import type { RevealLimitAlertMessage } from './ports/mailer.js';
import { renderRevealLimitEmail } from './render-reveal-limit-email.js';

const OCCURRED_AT = new Date('2026-03-04T15:30:00.000Z');
const BASE_MESSAGE: RevealLimitAlertMessage = {
  to: 'root@x.test',
  locale: 'es-MX',
  actorDisplayName: 'Sofía Operadora',
  limitPerHour: 30,
  revealedInWindow: 30,
  windowMinutes: 60,
  occurredAt: OCCURRED_AT,
};

describe('renderRevealLimitEmail', () => {
  it('is written in the recipient language, with its own subject', () => {
    const spanish = renderRevealLimitEmail(BASE_MESSAGE);
    const english = renderRevealLimitEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(spanish.subject).not.toBe(english.subject);
    expect(spanish.text).toContain('Sofía Operadora');
    expect(spanish.text).toContain('límite de 30 revelaciones');
    expect(english.text).toContain('limit of 30 password reveals');
    expect(english.text).toContain('2026');
  });

  it('states the moment in UTC and the counts', () => {
    const email = renderRevealLimitEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(email.text).toContain('UTC');
    expect(email.text).toContain('3:30 PM');
    expect(email.text).toContain('Reveals in the window: 30 (60-minute window)');
  });

  it('omits the counts and names nobody when the event predates them', () => {
    const email = renderRevealLimitEmail({
      ...BASE_MESSAGE,
      actorDisplayName: null,
      revealedInWindow: null,
      windowMinutes: null,
    });

    expect(email.text).toContain('una persona de la organización');
    expect(email.text).not.toContain('Revelaciones en la ventana');
  });

  it('carries no links, no recipient address and no credential data', () => {
    const email = renderRevealLimitEmail({ ...BASE_MESSAGE, to: 'secret.root@x.test' });

    for (const body of [email.subject, email.text, email.html]) {
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toContain('secret.root');
    }
    // El nombre de la persona nunca va en el asunto (cabecera del correo).
    expect(email.subject).not.toContain('Sofía');
  });

  it('escapes the person name in the HTML body', () => {
    const email = renderRevealLimitEmail({
      ...BASE_MESSAGE,
      actorDisplayName: '"><script>alert(1)</script>',
    });

    expect(email.html).not.toContain('<script>');
  });

  it('strips line breaks and control characters so the name cannot forge lines', () => {
    const email = renderRevealLimitEmail({
      ...BASE_MESSAGE,
      actorDisplayName: 'Sofía\r\nAsunto: falso\t\u0000  Operadora',
    });

    expect(email.text.split('\n')[0]).toContain('Sofía Asunto: falso Operadora alcanzó');
    // Un párrafo por línea de contenido: el nombre no abrió párrafos ni líneas extra.
    expect(email.html.split('\n')).toHaveLength(4);
    expect(email.html.split('\n')[0]).toContain('Sofía Asunto: falso Operadora');
  });

  it('strips bidirectional and invisible formatting characters', () => {
    const hostileName = '\u202Eadmin\u202C\u2066x\u2069\u200Bio\u200F';
    const email = renderRevealLimitEmail({ ...BASE_MESSAGE, actorDisplayName: hostileName });

    expect(email.text).toContain('adminxio alcanzó');
    for (const body of [email.text, email.html]) {
      expect(body).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/);
    }
  });

  it('bounds the name length and falls back to the generic text when nothing visible remains', () => {
    const longName = 'A'.repeat(500);
    const bounded = renderRevealLimitEmail({ ...BASE_MESSAGE, actorDisplayName: longName });
    const empty = renderRevealLimitEmail({ ...BASE_MESSAGE, actorDisplayName: '\u200B\n ' });

    expect(bounded.text).toContain(`${'A'.repeat(80)} alcanzó`);
    expect(bounded.text).not.toContain('A'.repeat(81));
    expect(empty.text).toContain('una persona de la organización');
  });
});
