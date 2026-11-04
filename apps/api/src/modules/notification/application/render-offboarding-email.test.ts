import { describe, expect, it } from 'vitest';

import type { OffboardingNoticeMessage } from './ports/mailer.js';
import { renderOffboardingEmail } from './render-offboarding-email.js';

const BASE: OffboardingNoticeMessage = {
  to: 'persona@x.test',
  locale: 'es-MX',
  kind: 'accounts_assigned',
  leaverDisplayName: 'Luis Operador',
  accountCount: 2,
  report: null,
  occurredAt: new Date('2026-11-04T15:30:00.000Z'),
};

describe('renderOffboardingEmail', () => {
  it('names who left and how many accounts, in the recipient language', () => {
    const spanish = renderOffboardingEmail(BASE);
    const english = renderOffboardingEmail({ ...BASE, locale: 'en-US' });

    expect(spanish.text).toContain('Por la baja de Luis Operador, 2 cuentas quedaron a tu cargo');
    expect(english.text).toContain(
      'Because Luis Operador was offboarded, 2 accounts are now yours',
    );
    expect(spanish.subject).not.toBe(english.subject);
  });

  it('uses the singular for one account', () => {
    expect(renderOffboardingEmail({ ...BASE, accountCount: 1 }).text).toContain('1 cuenta quedó');
  });

  it('describes the unassigned alert and tells the Administrator what to do', () => {
    const email = renderOffboardingEmail({ ...BASE, kind: 'accounts_unassigned', accountCount: 3 });

    expect(email.text).toContain('3 cuentas quedaron sin responsable');
    expect(email.text).toContain('Asigna un responsable');
  });

  it('lists only counts in the report', () => {
    const email = renderOffboardingEmail({
      ...BASE,
      kind: 'report',
      report: { assignedAccountCount: 2, unassignedAccountCount: 1, rotationTaskCount: 7 },
    });

    expect(email.text).toContain('Cuentas reasignadas: 2.');
    expect(email.text).toContain('Cuentas sin responsable: 1.');
    expect(email.text).toContain('Tareas de rotación creadas: 7.');
  });

  it('states the moment in UTC and carries no links', () => {
    const email = renderOffboardingEmail(BASE);

    expect(email.text).toContain('UTC');
    expect(`${email.text}${email.html}`).not.toMatch(/https?:/);
  });

  it('escapes a hostile name in the HTML and falls back to a generic one when nothing is left', () => {
    const hostile = renderOffboardingEmail({
      ...BASE,
      leaverDisplayName: '<script>alert(1)</script>',
    });
    const unknown = renderOffboardingEmail({ ...BASE, leaverDisplayName: null });

    expect(hostile.html).not.toContain('<script>');
    expect(unknown.text).toContain('una persona de la organización');
  });
});

describe('renderOffboardingEmail: rotation tasks', () => {
  const ROTATION_BASE: OffboardingNoticeMessage = {
    ...BASE,
    kind: 'rotation_assigned',
    accountCount: 3,
  };

  it('tells whoever receives the rotation tasks how many and the deadline, in both languages', () => {
    const spanish = renderOffboardingEmail(ROTATION_BASE);
    const english = renderOffboardingEmail({ ...ROTATION_BASE, locale: 'en-US' });

    expect(spanish.text).toContain('3 tareas de rotación quedaron a tu cargo');
    expect(spanish.text).toContain('72 horas');
    expect(english.text).toContain('3 rotation tasks are now yours');
    expect(english.text).toContain('72 hours');
  });

  it('uses the singular for one task', () => {
    expect(renderOffboardingEmail({ ...ROTATION_BASE, accountCount: 1 }).text).toContain(
      '1 tarea de rotación quedó',
    );
  });
});
