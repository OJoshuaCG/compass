import { describe, expect, it } from 'vitest';

import type { ResetRevealAlertMessage } from './ports/mailer.js';
import { renderResetRevealEmail } from './render-reset-reveal-email.js';

const BASE_MESSAGE: ResetRevealAlertMessage = {
  to: 'root@x.test',
  locale: 'es-MX',
  actorDisplayName: 'Sofía Operadora',
  revealedCount: 2,
  occurredAt: new Date('2026-11-03T15:30:00.000Z'),
};

describe('renderResetRevealEmail', () => {
  it('dice quién, cuántos y cuándo en ambos idiomas', () => {
    const spanish = renderResetRevealEmail(BASE_MESSAGE);
    const english = renderResetRevealEmail({ ...BASE_MESSAGE, locale: 'en-US' });

    expect(spanish.subject).toContain('restablecimiento');
    expect(spanish.text).toContain('Sofía Operadora vio 2 restablecimientos');
    expect(spanish.text).toContain('UTC');
    expect(english.subject).toContain('reset');
    expect(english.text).toContain('Sofía Operadora viewed 2 resets');
  });

  it('usa el singular con un solo restablecimiento', () => {
    const email = renderResetRevealEmail({ ...BASE_MESSAGE, locale: 'en-US', revealedCount: 1 });

    expect(email.text).toContain('viewed 1 reset (code or link)');
  });

  it('sin nombre resoluble usa el texto genérico', () => {
    const email = renderResetRevealEmail({ ...BASE_MESSAGE, actorDisplayName: null });

    expect(email.text).toContain('una persona de la organización vio');
  });

  it('escapa el nombre en el HTML y no lleva enlaces ni el destinatario', () => {
    const email = renderResetRevealEmail({
      ...BASE_MESSAGE,
      actorDisplayName: '<img src=x onerror=alert(1)>',
      to: 'secret.root@x.test',
    });

    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('href');
    expect(email.text).not.toContain('http');
    expect(`${email.text}${email.html}`).not.toContain('secret.root@x.test');
  });
});
