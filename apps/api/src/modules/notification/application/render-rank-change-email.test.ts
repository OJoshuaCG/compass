import { describe, expect, it } from 'vitest';

import type { RankChangeNoticeMessage } from './ports/mailer.js';
import { renderRankChangeEmail } from './render-rank-change-email.js';

const CHANGED_AT = new Date('2026-03-04T15:30:00.000Z');
const BASE_MESSAGE: RankChangeNoticeMessage = {
  to: 'persona@x.test',
  locale: 'es-MX',
  changedByDisplayName: 'Ana Administradora',
  fromRank: 3,
  toRank: 2,
  changedAt: CHANGED_AT,
};

describe('renderRankChangeEmail', () => {
  it('is written in the recipient language and names who made the change and both ranks', () => {
    const spanish = renderRankChangeEmail(BASE_MESSAGE);
    const english = renderRankChangeEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(spanish.subject).not.toBe(english.subject);
    expect(spanish.text).toContain('Ana Administradora cambió tu rango de Operador a Líder');
    expect(english.text).toContain('Ana Administradora changed your rank from Operator to Lead');
  });

  it('states the moment in UTC', () => {
    const email = renderRankChangeEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(email.text).toContain('UTC');
    expect(email.text).toContain('3:30 PM');
  });

  it('notifies both a promotion and a demotion', () => {
    const promotion = renderRankChangeEmail({ ...BASE_MESSAGE, fromRank: 3, toRank: 1 });
    const demotion = renderRankChangeEmail({ ...BASE_MESSAGE, fromRank: 1, toRank: 3 });

    expect(promotion.text).toContain('de Operador a Administrador');
    expect(demotion.text).toContain('de Administrador a Operador');
  });

  it('names nobody when the person who made the change cannot be resolved', () => {
    const email = renderRankChangeEmail({ ...BASE_MESSAGE, changedByDisplayName: null });

    expect(email.text).toContain('una persona de la organización');
  });

  it('carries no links, no recipient address, no reason and no roles', () => {
    const email = renderRankChangeEmail({ ...BASE_MESSAGE, to: 'secret.person@x.test' });

    for (const body of [email.subject, email.text, email.html]) {
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toContain('secret.person');
      expect(body).not.toMatch(/motivo|reason|rol(es)?\b|roles?\b/i);
    }
    // El nombre de quien actuó nunca va en el asunto (cabecera del correo).
    expect(email.subject).not.toContain('Ana');
  });

  it('escapes the name in the HTML body and strips control characters', () => {
    const email = renderRankChangeEmail({
      ...BASE_MESSAGE,
      changedByDisplayName: '<script>alert(1)</script>\nOtra línea',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.text).not.toContain('\nOtra');
  });
});
